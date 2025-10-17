import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { StorageService } from './storage.service';
import * as crypto from 'crypto';
import * as pdfParse from 'pdf-parse';

export interface FileUploadResult {
  fileId: string;
  pages?: number;
  mime: string;
  checksum: string;
}

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    projectId?: string,
    filename?: string,
    tags?: string[],
  ): Promise<FileUploadResult> {
    // Validate file
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    // Calculate checksum
    const checksum = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    // Check if file already exists
    const existingFile = await this.prisma.file.findUnique({
      where: { checksum },
    });

    if (existingFile) {
      return {
        fileId: existingFile.id,
        pages: existingFile.pages,
        mime: existingFile.mime,
        checksum: existingFile.checksum,
      };
    }

    // Determine page count for PDFs
    let pages: number | undefined;
    if (file.mimetype === 'application/pdf') {
      try {
        const pdfData = await pdfParse(file.buffer);
        pages = pdfData.numpages;
      } catch (error) {
        console.warn('Failed to parse PDF pages:', error.message);
      }
    }

    // Upload to storage
    const storageKey = `files/${checksum}`;
    const storageUrl = await this.storageService.uploadFile(
      storageKey,
      file.buffer,
      file.mimetype,
    );

    // Save file record
    const savedFile = await this.prisma.file.create({
      data: {
        filename: filename || file.originalname,
        mime: file.mimetype,
        pages,
        checksum,
        size: BigInt(file.size),
        projectId,
        tags: tags || [],
        storageKey,
        storageUrl,
      },
    });

    return {
      fileId: savedFile.id,
      pages: savedFile.pages,
      mime: savedFile.mime,
      checksum: savedFile.checksum,
    };
  }

  async getFile(fileId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    return file;
  }

  async getFileBuffer(fileId: string): Promise<Buffer> {
    const file = await this.getFile(fileId);
    return this.storageService.downloadFile(file.storageKey);
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = await this.getFile(fileId);
    
    // Delete from storage
    await this.storageService.deleteFile(file.storageKey);
    
    // Delete from database
    await this.prisma.file.delete({
      where: { id: fileId },
    });
  }
}
