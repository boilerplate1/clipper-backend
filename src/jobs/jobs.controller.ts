import { Controller, Post, Body, Get, Param, Patch, Delete } from '@nestjs/common';
import { JobsService, JobStatus, Highlight } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  async createJob(
    @Body('url') url: string,
    @Body('clipsCount') clipsCount?: string | number,
    @Body('crop9x16') crop9x16?: boolean,
    @Body('thumbnail') thumbnail?: string,
    @Body('title') title?: string,
  ) {
    return this.jobsService.createJob(url, clipsCount, crop9x16, thumbnail, title);
  }

  @Get()
  async listJobs() {
    return this.jobsService.listJobs();
  }

  @Get(':id')
  async getJob(@Param('id') id: string) {
    return this.jobsService.getJobStatus(id);
  }

  @Patch(':id/status')
  async updateJobStatus(
    @Param('id') id: string,
    @Body('status') status?: JobStatus,
    @Body('progress') progress?: number,
    @Body('highlights') highlights?: Highlight[],
    @Body('log') log?: string,
    @Body('video_url') video_url?: string
  ) {
    return this.jobsService.updateJobStatus(id, { status, progress, highlights, log, video_url });
  }

  @Patch(':id/highlights/:idx')
  async updateHighlightClip(
    @Param('id') id: string,
    @Param('idx') idx: string,
    @Body('clip_url') clipUrl: string
  ) {
    return this.jobsService.updateHighlightClip(id, parseInt(idx, 10), clipUrl);
  }

  @Delete(':id')
  async cancelJob(@Param('id') id: string) {
    return this.jobsService.cancelJob(id);
  }
}
