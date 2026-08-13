import { Module } from '@nestjs/common';
import { RmqModule } from '../infra/rmq/rmq.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [RmqModule.register({ name: 'INFO', queue: 'CLIPPER.INFO' })],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
