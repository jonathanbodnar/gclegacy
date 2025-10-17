import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';

import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageService } from './storage.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        storage: memoryStorage(),
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
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, StorageService],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
