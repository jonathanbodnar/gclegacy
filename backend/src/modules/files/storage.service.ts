import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from 'aws-sdk';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private s3: S3 | null = null;
  private bucketName: string;
  private useLocalStorage: boolean = false;
  private localStoragePath: string = '/tmp/plantakeoff-storage';
  private readonly logger = new Logger(StorageService.name);

  constructor(private configService: ConfigService) {
    const hasWasabiConfig = 
      this.configService.get('WASABI_ACCESS_KEY_ID') && 
      this.configService.get('WASABI_SECRET_ACCESS_KEY') &&
      this.configService.get('WASABI_BUCKET_NAME');

    if (hasWasabiConfig) {
      this.logger.log('📦 Using Wasabi S3 storage');
      this.s3 = new S3({
        endpoint: this.configService.get('WASABI_ENDPOINT') || 'https://s3.wasabisys.com',
        region: this.configService.get('WASABI_REGION') || 'us-east-1',
        accessKeyId: this.configService.get('WASABI_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('WASABI_SECRET_ACCESS_KEY'),
        s3ForcePathStyle: true, // Required for Wasabi
      });
      
      this.bucketName = this.configService.get('WASABI_BUCKET_NAME');
    } else {
      this.logger.warn('⚠️  Wasabi credentials not configured - using local file storage at ' + this.localStoragePath);
      this.useLocalStorage = true;
      this.bucketName = 'local';
      
      // Create local storage directory
      if (!fs.existsSync(this.localStoragePath)) {
        fs.mkdirSync(this.localStoragePath, { recursive: true });
      }
    }
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (this.useLocalStorage) {
      const filePath = path.join(this.localStoragePath, key);
      const dir = path.dirname(filePath);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, buffer);
      return `file://${filePath}`;
    }

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    };

    const result = await this.s3!.upload(params).promise();
    return result.Location;
  }

  async downloadFile(key: string): Promise<Buffer> {
    this.logger.log(`📥 Downloading file: ${key}`);
    const startTime = Date.now();

    if (this.useLocalStorage) {
      const filePath = path.join(this.localStoragePath, key);
      this.logger.log(`📂 Reading from local storage: ${filePath}`);
      const buffer = fs.readFileSync(filePath);
      this.logger.log(`✅ Local file read complete: ${(buffer.length / 1024 / 1024).toFixed(2)} MB in ${Date.now() - startTime}ms`);
      return buffer;
    }

    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    this.logger.log(`☁️  Downloading from S3/Wasabi: bucket=${this.bucketName}, key=${key}`);
    try {
      const result = await this.s3!.getObject(params).promise();
      const buffer = result.Body as Buffer;
      this.logger.log(`✅ S3 download complete: ${(buffer.length / 1024 / 1024).toFixed(2)} MB in ${Date.now() - startTime}ms`);
      return buffer;
    } catch (error: any) {
      this.logger.error(`❌ S3 download failed after ${Date.now() - startTime}ms: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    if (this.useLocalStorage) {
      const filePath = path.join(this.localStoragePath, key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    await this.s3!.deleteObject(params).promise();
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (this.useLocalStorage) {
      // For local storage, return a file path (not ideal for production)
      const filePath = path.join(this.localStoragePath, key);
      return `file://${filePath}`;
    }

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Expires: expiresIn,
    };

    return this.s3!.getSignedUrl('getObject', params);
  }

  async uploadArtifact(
    jobId: string,
    sheetId: string,
    type: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = `artifacts/${jobId}/${sheetId}.${type}`;
    return this.uploadFile(key, buffer, contentType);
  }

  async getArtifactSignedUrl(
    jobId: string,
    sheetId: string,
    type: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const key = `artifacts/${jobId}/${sheetId}.${type}`;
    return this.getSignedUrl(key, expiresIn);
  }
}
