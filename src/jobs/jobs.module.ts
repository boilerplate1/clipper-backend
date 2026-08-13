import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { RmqModule } from '../infra/rmq/rmq.module';

@Module({
  imports: [
    RmqModule.register({ name: 'CLIPPER' }),
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
