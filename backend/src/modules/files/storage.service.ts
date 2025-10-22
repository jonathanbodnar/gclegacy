import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from 'aws-sdk';

@Injectable()
export class StorageService {
  private s3: S3;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.s3 = new S3({
      endpoint: this.configService.get('WASABI_ENDPOINT') || 'https://s3.wasabisys.com',
      region: this.configService.get('WASABI_REGION') || 'us-east-1',
      accessKeyId: this.configService.get('WASABI_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get('WASABI_SECRET_ACCESS_KEY'),
      s3ForcePathStyle: true, // Required for Wasabi
    });
    
    this.bucketName = this.configService.get('WASABI_BUCKET_NAME');
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    };

    const result = await this.s3.upload(params).promise();
    return result.Location;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    const result = await this.s3.getObject(params).promise();
    return result.Body as Buffer;
  }

  async deleteFile(key: string): Promise<void> {
    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    await this.s3.deleteObject(params).promise();
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const params = {
      Bucket: this.bucketName,
      Key: key,
      Expires: expiresIn,
    };

    return this.s3.getSignedUrl('getObject', params);
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
