import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JobStatus } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface WebhookPayload {
  event: string;
  jobId: string;
  status: JobStatus;
  timestamp: string;
  data?: any;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  async sendWebhook(url: string, payload: WebhookPayload, retries: number = 3): Promise<boolean> {
    const timeout = parseInt(this.configService.get('WEBHOOK_TIMEOUT', '30000'));
    const signature = this.generateSignature(payload);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.logger.log(`Sending webhook to ${url} (attempt ${attempt}/${retries})`);

        const response = await firstValueFrom(
          this.httpService.post(url, payload, {
            timeout,
            headers: {
              'Content-Type': 'application/json',
              'X-PlanTakeoff-Signature': signature,
              'X-PlanTakeoff-Event': payload.event,
              'User-Agent': 'PlanTakeoff-Webhook/1.0',
            },
          })
        );

        if (response.status >= 200 && response.status < 300) {
          this.logger.log(`Webhook sent successfully to ${url}`);
          return true;
        } else {
          this.logger.warn(`Webhook failed with status ${response.status}: ${url}`);
        }

      } catch (error) {
        this.logger.error(`Webhook attempt ${attempt} failed for ${url}:`, error.message);
        
        if (attempt === retries) {
          this.logger.error(`All webhook attempts failed for ${url}`);
          return false;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await this.sleep(delay);
      }
    }

    return false;
  }

  async notifyJobStatusChange(jobId: string, status: JobStatus, webhookUrl?: string, data?: any): Promise<void> {
    if (!webhookUrl) {
      this.logger.debug(`No webhook URL provided for job ${jobId}`);
      return;
    }

    const payload: WebhookPayload = {
      event: 'job.status_changed',
      jobId,
      status,
      timestamp: new Date().toISOString(),
      data,
    };

    const maxRetries = parseInt(this.configService.get('WEBHOOK_RETRIES', '3'));
    await this.sendWebhook(webhookUrl, payload, maxRetries);
  }

  async notifyJobCompleted(jobId: string, webhookUrl?: string, results?: any): Promise<void> {
    if (!webhookUrl) {
      this.logger.debug(`No webhook URL provided for job ${jobId}`);
      return;
    }

    const payload: WebhookPayload = {
      event: 'job.completed',
      jobId,
      status: JobStatus.COMPLETED,
      timestamp: new Date().toISOString(),
      data: {
        results,
        message: 'Job completed successfully',
      },
    };

    const maxRetries = parseInt(this.configService.get('WEBHOOK_RETRIES', '3'));
    await this.sendWebhook(webhookUrl, payload, maxRetries);
  }

  async notifyJobFailed(jobId: string, webhookUrl?: string, error?: string): Promise<void> {
    if (!webhookUrl) {
      this.logger.debug(`No webhook URL provided for job ${jobId}`);
      return;
    }

    const payload: WebhookPayload = {
      event: 'job.failed',
      jobId,
      status: JobStatus.FAILED,
      timestamp: new Date().toISOString(),
      data: {
        error,
        message: 'Job processing failed',
      },
    };

    const maxRetries = parseInt(this.configService.get('WEBHOOK_RETRIES', '3'));
    await this.sendWebhook(webhookUrl, payload, maxRetries);
  }

  async testWebhook(url: string): Promise<{ success: boolean; response?: any; error?: string }> {
    const testPayload: WebhookPayload = {
      event: 'webhook.test',
      jobId: 'test-job-id',
      status: JobStatus.COMPLETED,
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook from PlanTakeoff API',
        testId: crypto.randomUUID(),
      },
    };

    try {
      const success = await this.sendWebhook(url, testPayload, 1);
      return {
        success,
        response: success ? 'Webhook test successful' : 'Webhook test failed',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private generateSignature(payload: WebhookPayload): string {
    const secret = this.configService.get('WEBHOOK_SECRET', 'default-webhook-secret');
    const body = JSON.stringify(payload);
    
    return crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility method to verify webhook signatures (for incoming webhooks if needed)
  verifySignature(body: string, signature: string): boolean {
    const secret = this.configService.get('WEBHOOK_SECRET', 'default-webhook-secret');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}
