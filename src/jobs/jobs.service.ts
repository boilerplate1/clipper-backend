import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { Highlight as PrismaHighlight, Job as PrismaJob } from '../generated/prisma/client';

const STUCK_TIMEOUT_MS = 30 * 60 * 1000;
const STUCK_CHECK_INTERVAL_MS = 60 * 1000;

export type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'CANCELED';

export interface Highlight {
  start: string;
  end: string;
  title: string;
  virality_score: number;
  hook_sentence: string;
  reasoning?: string;
  reason?: string;
  virality_prediction?: string;
  clip_url?: string;
}

export interface JobEntity {
  id: string;
  url: string;
  title?: string;
  clipsCount: string | number;
  status: JobStatus;
  progress: number;
  logs: string[];
  highlights?: Highlight[];
  video_url?: string;
  crop9x16?: boolean;
  thumbnail?: string;
  createdAt: Date;
}

export interface UpdateJobDto {
  status?: JobStatus;
  progress?: number;
  highlights?: Highlight[];
  log?: string;
  video_url?: string;
}

type JobWithHighlights = PrismaJob & { highlights: PrismaHighlight[] };

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobsStore = new Map<string, JobEntity>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject('CLIPPER') private readonly rmqClient: ClientProxy,
  ) {}

  onModuleInit() {
    const timer = setInterval(() => this.failStuckJobs(), STUCK_CHECK_INTERVAL_MS);
    timer.unref?.();
    this.logger.log(
      `Auto-fail watchdog enabled: jobs stuck in PROCESSING for >${STUCK_TIMEOUT_MS / 60000} min will be failed.`,
    );
  }

  private async failStuckJobs(): Promise<void> {
    if (!this.prisma.available) return;
    try {
      const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS);
      const stuck = await this.prisma.job.findMany({
        where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
        select: { id: true },
      });
      for (const job of stuck) {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            logs: {
              push: [`[${new Date().toISOString()}] Задача зависла — превышен лимит времени обработки.`],
            },
          },
        });
        this.logger.warn(`[Job ${job.id}] Auto-failed: stuck in PROCESSING for too long.`);
      }

      // Failed projects are never kept: purge them after a grace period so the
      // frontend still gets one chance to read the error message.
      const failedCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const deleted = await this.prisma.job.deleteMany({
        where: { status: 'FAILED', updatedAt: { lt: failedCutoff } },
      });
      if (deleted.count > 0) {
        this.logger.log(`Cleaned up ${deleted.count} old FAILED job(s).`);
      }
    } catch (e: any) {
      this.logger.warn(`failStuckJobs error: ${e.message}`);
    }
  }

  async createJob(
    url: string,
    clipsCount: string | number = 'auto',
    crop9x16: boolean = true,
    thumbnail?: string,
    title?: string,
  ): Promise<JobEntity> {
    const jobId = Math.random().toString(36).substring(2, 9);

    const newJob: JobEntity = {
      id: jobId,
      url,
      title,
      clipsCount,
      crop9x16,
      thumbnail,
      status: 'PENDING',
      progress: 0,
      logs: [`[${new Date().toISOString()}] Задача создана.`],
      createdAt: new Date(),
    };

    if (this.prisma.available) {
      try {
        await this.prisma.job.create({
          data: {
            id: jobId,
            url,
            title: title ?? null,
            clipsCount: String(clipsCount),
            crop9x16,
            thumbnail: thumbnail ?? null,
            status: 'PENDING',
            progress: 0,
            logs: newJob.logs,
          },
        });
      } catch (e: any) {
        this.logger.error(`[Job ${jobId}] Failed to persist job: ${e.message}`);
      }
    } else {
      this.jobsStore.set(jobId, newJob);
    }

    this.logger.log(`[Job ${jobId}] Created new job for URL: ${url} (Clips: ${clipsCount}, 9:16: ${crop9x16})`);

    // Emit task event to RabbitMQ worker
    this.rmqClient.emit('process_video', { jobId, url, clipsCount, crop9x16 });

    return newJob;
  }

  async listJobs(): Promise<JobEntity[]> {
    if (this.prisma.available) {
      try {
        const jobs = await this.prisma.job.findMany({
          where: { status: { not: 'FAILED' } },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { highlights: { orderBy: { idx: 'asc' } } },
        });
        return jobs.map((job) => this.mapJob(job));
      } catch (e: any) {
        this.logger.error(`Failed to list jobs: ${e.message}`);
      }
    }
    return Array.from(this.jobsStore.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getJobStatus(jobId: string): Promise<JobEntity> {
    if (this.prisma.available) {
      try {
        const job = await this.prisma.job.findUnique({
          where: { id: jobId },
          include: { highlights: { orderBy: { idx: 'asc' } } },
        });
        if (!job) {
          throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
        }
        return this.mapJob(job);
      } catch (e: any) {
        if (e instanceof NotFoundException) throw e;
        this.logger.warn(`DB read failed for job ${jobId}, using in-memory: ${e.message}`);
      }
    }

    const job = this.jobsStore.get(jobId);
    if (!job) {
      throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
    }
    return job;
  }

  async updateJobStatus(jobId: string, updateData: UpdateJobDto): Promise<JobEntity> {
    if (this.prisma.available) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.job.findUnique({
            where: { id: jobId },
            select: { status: true },
          });
          if (!existing) {
            throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
          }

          const current = existing.status as JobStatus;
          let newStatus = updateData.status;
          if (current === 'CANCELED' && updateData.status) {
            this.logger.warn(
              `[Job ${jobId}] Ignored status update '${updateData.status}' because job was canceled.`,
            );
            newStatus = undefined;
          }

          const logEntry = updateData.log
            ? `[${new Date().toISOString()}] ${updateData.log}`
            : undefined;

          await tx.job.update({
            where: { id: jobId },
            data: {
              status: newStatus ?? existing.status,
              progress: updateData.progress ?? undefined,
              videoUrl: updateData.video_url ?? undefined,
              logs: logEntry ? { push: [logEntry] } : undefined,
            },
          });

          if (updateData.highlights) {
            await tx.highlight.deleteMany({ where: { jobId } });
            if (updateData.highlights.length > 0) {
              await tx.highlight.createMany({
                data: updateData.highlights.map((h, i) => ({
                  jobId,
                  idx: i,
                  startTs: h.start != null ? String(h.start) : null,
                  endTs: h.end != null ? String(h.end) : null,
                  title: h.title ?? null,
                  reason: h.reason ?? h.reasoning ?? null,
                  hookSentence: h.hook_sentence ?? null,
                  viralityScore: h.virality_score ?? null,
                  viralityPrediction: h.virality_prediction ?? null,
                  clipUrl: h.clip_url ?? null,
                })),
              });
            }
          }
        });

        return this.getJobStatus(jobId);
      } catch (e: any) {
        if (e instanceof NotFoundException) throw e;
        this.logger.warn(`DB update failed for job ${jobId}, using in-memory: ${e.message}`);
      }
    }

    const job = this.jobsStore.get(jobId);
    if (!job) {
      throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
    }

    // Protection: Canceled jobs cannot be overridden by worker status
    if (job.status === 'CANCELED' && updateData.status) {
      this.logger.warn(`[Job ${jobId}] Ignored status update '${updateData.status}' because job was canceled.`);
    } else if (updateData.status) {
      job.status = updateData.status;
    }

    if (updateData.progress !== undefined) {
      job.progress = updateData.progress;
    }
    if (updateData.highlights) {
      job.highlights = updateData.highlights;
    }
    if (updateData.video_url) {
      job.video_url = updateData.video_url;
    }
    if (updateData.log) {
      const formattedLog = `[${new Date().toISOString()}] ${updateData.log}`;
      job.logs.push(formattedLog);
      this.logger.log(`[Worker -> Job ${jobId}] ${updateData.log}`);
    }

    this.jobsStore.set(jobId, job);
    return job;
  }

  async cancelJob(jobId: string): Promise<JobEntity> {
    if (this.prisma.available) {
      try {
        const job = await this.prisma.job.findUnique({ where: { id: jobId } });
        if (!job) {
          throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
        }
        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: 'CANCELED' },
        });
        return this.getJobStatus(jobId);
      } catch (e: any) {
        if (e instanceof NotFoundException) throw e;
        this.logger.warn(`DB cancel failed for job ${jobId}, using in-memory: ${e.message}`);
      }
    }

    const job = this.jobsStore.get(jobId);
    if (!job) {
      throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
    }

    job.status = 'CANCELED';
    job.logs.push(`[${new Date().toISOString()}] Пользователь отменил выполнение задачи.`);
    this.jobsStore.set(jobId, job);

    this.logger.log(`[Job ${jobId}] Canceled by user.`);
    return job;
  }

  async updateHighlightClip(jobId: string, idx: number, clipUrl: string): Promise<JobEntity> {
    if (!clipUrl) {
      throw new NotFoundException('clip_url is required');
    }
    if (this.prisma.available) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const job = await tx.job.findUnique({
            where: { id: jobId },
            include: { highlights: { orderBy: { idx: 'asc' } } },
          });
          if (!job) {
            throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
          }
          if (job.status === 'CANCELED') {
            this.logger.warn(`[Job ${jobId}] Ignored clip update because job was canceled.`);
            return this.mapJob(job);
          }

          const hl = job.highlights.find((h) => h.idx === idx);
          if (!hl) {
            throw new NotFoundException(`Highlight #${idx} для задачи "${jobId}" не найден.`);
          }

          await tx.highlight.update({ where: { id: hl.id }, data: { clipUrl } });

          const empty = await tx.highlight.count({ where: { jobId, clipUrl: null } });
          if (empty === 0) {
            await tx.job.update({ where: { id: jobId }, data: { status: 'DONE' } });
            this.logger.log(`[Job ${jobId}] All clips rendered. Job completed.`);
          }

          return this.getJobStatus(jobId);
        });
      } catch (e: any) {
        if (e instanceof NotFoundException) throw e;
        this.logger.warn(`DB clip update failed for job ${jobId}, using in-memory: ${e.message}`);
      }
    }

    const job = this.jobsStore.get(jobId);
    if (!job) {
      throw new NotFoundException(`Задача с ID "${jobId}" не найдена.`);
    }
    if (job.status !== 'CANCELED' && job.highlights) {
      const hl = job.highlights[idx];
      if (hl) hl.clip_url = clipUrl;
    }
    this.jobsStore.set(jobId, job);
    return job;
  }

  private mapJob(job: JobWithHighlights): JobEntity {
    return {
      id: job.id,
      url: job.url,
      title: job.title ?? undefined,
      clipsCount: job.clipsCount,
      status: job.status as JobStatus,
      progress: job.progress,
      logs: Array.isArray(job.logs) ? (job.logs as string[]) : [],
      video_url: job.videoUrl ?? undefined,
      crop9x16: job.crop9x16 ?? true,
      thumbnail: job.thumbnail ?? undefined,
      highlights: job.highlights.length
        ? job.highlights.map((r) => this.mapHighlight(r))
        : undefined,
      createdAt: job.createdAt,
    };
  }

  private mapHighlight(r: PrismaHighlight): Highlight {
    return {
      start: r.startTs,
      end: r.endTs,
      title: r.title,
      virality_score: r.viralityScore,
      hook_sentence: r.hookSentence,
      reasoning: r.reason ?? undefined,
      reason: r.reason ?? undefined,
      virality_prediction: r.viralityPrediction ?? undefined,
      clip_url: r.clipUrl ?? undefined,
    };
  }
}
