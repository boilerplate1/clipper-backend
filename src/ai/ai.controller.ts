import { Controller, Post, UseInterceptors, UploadedFile, HttpException, HttpStatus, Body, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AiService, AiError } from './ai.service';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);
  constructor(private readonly aiService: AiService) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Загрузить аудио и получить JSON хайлайты' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        clipsCount: {
          type: 'string',
        }
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: os.tmpdir(),
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'audio-' + uniqueSuffix + '.ogg');
      }
    })
  }))
  async analyze(
    @UploadedFile() file: Express.Multer.File,
    @Body('clipsCount') clipsCount?: string
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
    }
    
    try {
      const highlights = await this.aiService.analyzeAudio(file.path, clipsCount);
      // Clean up the temp file
      fs.unlinkSync(file.path);
      return highlights;
    } catch (e: any) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      if (e instanceof AiError) {
        throw new HttpException(e.code, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      this.logger.error(`AI analyze failed: ${e?.message ?? e}`);
      throw new HttpException('AI_UNKNOWN', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

