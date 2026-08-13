import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { randomUUID } from 'crypto';

export interface VideoInfo {
  title?: string;
  thumbnail?: string;
  duration?: number;
  sizeBytes?: number;
  width?: number;
  height?: number;
  extractor?: string;
  extractorKey?: string;
  webpage_url?: string;
}

export interface InfoRequest {
  id: string;
  url: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  createdAt: number;
  progress?: number;
  title?: string;
  info?: VideoInfo;
  error?: string;
}

const TTL_MS = 120_000;

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);
  private readonly requests = new Map<string, InfoRequest>();

  constructor(@Inject('INFO') private readonly infoClient: ClientProxy) {}

  async requestInfo(url: string): Promise<{ id: string }> {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new HttpException('VIDEO_INVALID_URL', HttpStatus.BAD_REQUEST);
    }

    const id = randomUUID().slice(0, 8);
    this.requests.set(id, { id, url, status: 'PENDING', createdAt: Date.now(), progress: 0 });
    this.infoClient.emit('video_info', { requestId: id, url });
    this.logger.log(`Info request ${id} queued: ${url}`);
    return { id };
  }

  getInfo(id: string): InfoRequest {
    const req = this.requests.get(id);
    if (!req) {
      throw new HttpException('VIDEO_INFO_FAILED', HttpStatus.NOT_FOUND);
    }
    if (req.status === 'PENDING' && Date.now() - req.createdAt > TTL_MS) {
      req.status = 'FAILED';
      req.error = 'VIDEO_NO_WORKER';
    }
    return req;
  }

  saveInfoResult(id: string, payload: any): { ok: boolean } {
    const req = this.requests.get(id);
    if (!req) {
      return { ok: false };
    }

    if (payload?.error) {
      req.status = 'FAILED';
      req.error = String(payload.error);
      return { ok: true };
    }

    if (typeof payload?.progress === 'number') {
      req.progress = payload.progress;
    }
    if (payload?.title) {
      req.title = String(payload.title);
    }
    if (payload?.info) {
      req.status = 'DONE';
      req.info = payload.info;
      req.title = req.title || payload.info?.title;
    }
    return { ok: true };
  }
}
