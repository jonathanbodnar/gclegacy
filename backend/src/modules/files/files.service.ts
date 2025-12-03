import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "./storage.service";
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
} from "@prisma/client/runtime/library";
import * as crypto from "crypto";
import * as pdfParse from "pdf-parse";

export interface FileUploadResult {
  fileId: string;
  pages?: number;
  mime: string;
  checksum: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    projectId?: string,
    filename?: string,
    tags?: string[]
  ): Promise<FileUploadResult> {
    // Validate file
    if (!file || !file.buffer) {
      throw new BadRequestException("No file provided");
    }

    // Calculate checksum
    const checksum = crypto
      .createHash("sha256")
      .update(file.buffer)
      .digest("hex");

    // Check if file already exists
    let existingFile;
    try {
      existingFile = await this.prisma.file.findUnique({
        where: { checksum },
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof PrismaClientInitializationError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }

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
    if (file.mimetype === "application/pdf") {
      try {
        const pdfData = await pdfParse(file.buffer);
        console.log("PDF data:", pdfData);
        pages = pdfData.numpages;
      } catch (error) {
        console.warn("Failed to parse PDF pages:", error.message);
      }
    }

    // Upload to storage
    const storageKey = `files/${checksum}`;
    const storageUrl = await this.storageService.uploadFile(
      storageKey,
      file.buffer,
      file.mimetype
    );

    // Save file record
    let savedFile;
    try {
      savedFile = await this.prisma.file.create({
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
    } catch (error: any) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof PrismaClientInitializationError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }

      if (error.code === "P2002" && error.meta?.target?.includes("checksum")) {
        // Another request created this file concurrently – reuse that record
        try {
          const duplicate = await this.prisma.file.findUnique({
            where: { checksum },
          });
          if (duplicate) {
            return {
              fileId: duplicate.id,
              pages: duplicate.pages,
              mime: duplicate.mime,
              checksum: duplicate.checksum,
            };
          }
        } catch (dupError: any) {
          if (
            dupError instanceof PrismaClientKnownRequestError ||
            dupError instanceof PrismaClientInitializationError ||
            dupError instanceof Error
          ) {
            if (
              dupError.message?.includes("Can't reach database server") ||
              dupError.message?.includes("database server")
            ) {
              this.logger.error("Database connection failed:", dupError.message);
              throw new ServiceUnavailableException(
                "Database service is currently unavailable. Please try again later."
              );
            }
          }
          throw dupError;
        }
      }
      throw error;
    }

    return {
      fileId: savedFile.id,
      pages: savedFile.pages,
      mime: savedFile.mime,
      checksum: savedFile.checksum,
    };
  }

  async getFile(fileId: string) {
    try {
      const file = await this.prisma.file.findUnique({
        where: { id: fileId },
      });

      if (!file) {
        throw new BadRequestException("File not found");
      }

      return file;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof PrismaClientInitializationError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
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
    try {
      await this.prisma.file.delete({
        where: { id: fileId },
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError ||
        error instanceof PrismaClientInitializationError ||
        error instanceof Error
      ) {
        if (
          error.message?.includes("Can't reach database server") ||
          error.message?.includes("database server")
        ) {
          this.logger.error("Database connection failed:", error.message);
          throw new ServiceUnavailableException(
            "Database service is currently unavailable. Please try again later."
          );
        }
      }
      throw error;
    }
  }
}
