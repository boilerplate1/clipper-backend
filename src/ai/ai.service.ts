import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { transcriptPrompt } from './prompt';

const NON_RETRYABLE_STATUS = new Set([400, 403, 404]);

/**
 * Error thrown to the caller. `code` is a stable, leak-free identifier
 * (e.g. "AI_429") that the frontend translates to a localized message.
 * Detailed diagnostics are kept in the server logs only.
 */
export class AiError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number) {
    super(code);
    this.name = 'AiError';
  }
}

function isNetworkError(e: any): boolean {
  const msg = `${e?.message ?? ''} ${e?.cause?.message ?? ''} ${e?.code ?? ''}`;
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|socket hang up|network/i.test(
    msg,
  );
}

function errorCode(status: number | undefined, network: boolean): string {
  switch (status) {
    case 400: return 'AI_400';
    case 403: return 'AI_403';
    case 404: return 'AI_404';
    case 429: return 'AI_429';
  }
  if (status && status >= 500) return 'AI_5XX';
  if (network) return 'AI_NETWORK';
  return 'AI_UNKNOWN';
}

function extractHighlights(parsed: any): any[] | null {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object') {
    for (const key of ['clips', 'highlights', 'result', 'data', 'moments']) {
      if (Array.isArray(parsed[key])) {
        return parsed[key];
      }
    }
    const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
    if (firstArray) {
      return firstArray;
    }
  }
  return null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private groqApiKey: string;
  private groqWhisperModel: string;
  private groqChatModel: string;

  constructor(private configService: ConfigService) {
    this.groqApiKey = this.configService.get<string>('groq.apiKey') || '';
    this.groqWhisperModel = this.configService.get<string>('groq.whisperModel') || 'whisper-large-v3-turbo';
    this.groqChatModel = this.configService.get<string>('groq.chatModel') || 'llama-3.3-70b-versatile';
  }

  private getMimeType(audioPath: string): string {
    const ext = path.extname(audioPath).toLowerCase();
    switch (ext) {
      case '.ogg': return 'audio/ogg';
      case '.mp3': return 'audio/mp3';
      case '.m4a': return 'audio/m4a';
      case '.wav': return 'audio/wav';
      case '.webm': return 'audio/webm';
      default: return 'audio/ogg';
    }
  }

  private async withRetry(action: string, fn: () => Promise<any>): Promise<any> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (e: any) {
        if (e instanceof AiError && e.code !== 'AI_429') {
          throw e;
        }
        attempt++;
        const status: number | undefined = e?.status;
        const network = isNetworkError(e);
        const code = e instanceof AiError ? e.code : errorCode(status, network);

        // Full detail stays server-side only.
        this.logger.warn(
          `${action} attempt ${attempt}/4 failed [${code}]: ${e?.message ?? e}${e?.cause?.message ? ` (cause: ${e.cause.message})` : ''}`,
        );

        if (attempt >= 4) {
          throw e instanceof AiError ? e : new AiError(code);
        }

        // Rate limit: wait for the window Groq told us about, then retry.
        if (code === 'AI_429') {
          const wait = Math.min(e instanceof AiError && e.retryAfterSeconds ? e.retryAfterSeconds : 10, 60);
          this.logger.log(`${action} rate limited, waiting ${wait}s before retry...`);
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }

        const retryable = network || !status || !NON_RETRYABLE_STATUS.has(status);
        if (!retryable) {
          throw new AiError(code);
        }
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }

  async analyzeAudio(audioPath: string, clipsCount: string = 'auto'): Promise<any[]> {
    const mimeType = this.getMimeType(audioPath);
    this.logger.log(`Analyzing audio file: ${audioPath} (${mimeType})`);

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found at path: ${audioPath}`);
    }
    if (!this.groqApiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    let countInstruction = "10";
    if (clipsCount && clipsCount !== 'auto') {
      countInstruction = String(clipsCount);
    }

    this.logger.log(`[GROQ] Transcribing with "${this.groqWhisperModel}"...`);

    const transcript = await this.withRetry('Groq Whisper transcription', () =>
      this.groqTranscribe(audioPath),
    );

    if (!transcript.trim()) {
      throw new AiError('AI_UNKNOWN');
    }

    const prompt = transcriptPrompt
      .replace('identify the 10 most viral', `identify the ${countInstruction} most viral`)
      .replace('__TRANSCRIPT__', transcript);

    this.logger.log(`[GROQ] Analyzing transcript (${transcript.split('\n').length} segments) with "${this.groqChatModel}"...`);

    const highlights = await this.groqAnalyzeWithRetry(prompt);
    this.logger.log(`[GROQ] Analysis completed: ${highlights.length} highlights.`);
    return highlights;
  }

  private async groqAnalyzeWithRetry(prompt: string): Promise<any[]> {
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const body = await this.withRetry(`Groq Chat Analysis (${this.groqChatModel})`, () =>
        this.groqChat(attempt > 1 ? prompt + '\n\nIMPORTANT: return ONLY a raw JSON array, no wrapper object, no markdown.' : prompt),
      );

      const text = body?.choices?.[0]?.message?.content ?? '';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        const arr = extractHighlights(parsed);
        if (arr) {
          return arr;
        }
        lastError = new Error('Groq returned non-array response');
      } catch (e: any) {
        lastError = e;
      }
      this.logger.warn(`[GROQ] Chat content invalid (attempt ${attempt}/3), retrying: ${lastError?.message ?? lastError}`);
    }
    throw lastError ?? new Error('Groq analysis failed');
  }

  private async groqTranscribe(audioPath: string): Promise<string> {
    const form = new FormData();
    form.append('model', this.groqWhisperModel);
    form.append('response_format', 'verbose_json');
    form.append(
      'file',
      new Blob([fs.readFileSync(audioPath)], { type: this.getMimeType(audioPath) }),
      path.basename(audioPath),
    );

    const res = await fetch(`https://api.groq.com/openai/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.groqApiKey}` },
      body: form,
    });

    const json = await this.readJson(res);
    if (!res.ok) {
      throw this.groqError(res, json, 'Whisper transcription');
    }

    const segments: { start?: number; end?: number; text?: string }[] = json?.segments ?? [];
    if (!segments.length && typeof json?.text === 'string') {
      return json.text;
    }

    return segments
      .map((s) => `[${this.fmtTs(s.start ?? 0)}] ${(s.text ?? '').trim()}`)
      .filter(Boolean)
      .join('\n');
  }

  private async groqChat(prompt: string): Promise<any> {
    const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.groqChatModel,
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const json = await this.readJson(res);
    if (!res.ok) {
      throw this.groqError(res, json, 'Groq chat');
    }
    return json;
  }

  private async readJson(res: Response): Promise<any> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  private groqError(res: Response, json: any, action: string): AiError {
    const status = res.status;
    const detail = json?.error?.message ?? res.statusText;
    const retryAfter = this.parseRetryAfter(res, detail);
    this.logger.error(`[GROQ] ${action} failed HTTP ${status}: ${detail}`);
    return new AiError(errorCode(status, false), retryAfter);
  }

  private parseRetryAfter(res: Response, detail: string): number | undefined {
    const header = Number(res.headers.get('retry-after'));
    if (Number.isFinite(header) && header > 0) {
      return header;
    }
    const m = /try again in ([\d.]+)s/i.exec(detail ?? '');
    if (m && Number.isFinite(Number(m[1]))) {
      return Math.ceil(Number(m[1]));
    }
    return undefined;
  }

  private fmtTs(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}
