import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageService } from './storage.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(process.cwd(), 'temp', 'uploads');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
          console.log(`📁 Created temp upload directory: ${tempDir}`);
        } else {
          console.log(`📁 Using existing temp upload directory: ${tempDir}`);
        }

        return {
          storage: diskStorage({
            destination: (req, file, cb) => {
              cb(null, tempDir);
            },
            filename: (req, file, cb) => {
              const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
              cb(null, `${uniqueSuffix}-${file.originalname}`);
            },
          }),
          limits: {
            fileSize: parseInt(configService.get('MAX_FILE_SIZE', '104857600')), // 100MB default
          },
          fileFilter: (req, file, callback) => {
            const supportedTypes = configService
              .get('SUPPORTED_MIME_TYPES', 'application/pdf,image/vnd.dwg')
              .split(',');
            
            if (supportedTypes.includes(file.mimetype)) {
              callback(null, true);
            } else {
              callback(new Error(`Unsupported file type: ${file.mimetype}`), false);
            }
          },
        };
      },
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, StorageService],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
