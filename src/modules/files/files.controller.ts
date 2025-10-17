import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsArray } from 'class-validator';

import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class FileUploadDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

class FileUploadResponse {
  @ApiProperty({ example: 'file_abc123' })
  fileId: string;

  @ApiProperty({ example: 25, required: false })
  pages?: number;

  @ApiProperty({ example: 'application/pdf' })
  mime: string;

  @ApiProperty({ example: 'a1b2c3d4e5f6...' })
  checksum: string;
}

@ApiTags('Files')
@Controller('files')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ 
    summary: 'Upload a plan file',
    description: 'Upload architectural/MEP plans in PDF, DWG/DXF, RVT/IFC formats'
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ 
    status: 201, 
    description: 'File uploaded successfully',
    type: FileUploadResponse
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid file or unsupported format' 
  })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadDto: FileUploadDto,
  ): Promise<FileUploadResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return this.filesService.uploadFile(
      file,
      uploadDto.projectId,
      uploadDto.filename,
      uploadDto.tags,
    );
  }
}
