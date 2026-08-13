import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import configuration from './infra/config/configuration';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    AiModule,
    JobsModule,
    VideosModule,
  ],
})
export class AppModule {}
