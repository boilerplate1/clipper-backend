import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('info')
  async requestInfo(@Body('url') url: string) {
    return this.videosService.requestInfo(url);
  }

  @Get('info/:id')
  async getInfo(@Param('id') id: string) {
    return this.videosService.getInfo(id);
  }

  @Post('info/:id/result')
  async saveResult(@Param('id') id: string, @Body() payload: any) {
    return this.videosService.saveInfoResult(id, payload);
  }
}
