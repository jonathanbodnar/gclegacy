import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class TestWebhookRequest {
  @ApiProperty({ 
    example: 'https://yourapp.com/hooks/plan',
    description: 'Webhook URL to test'
  })
  @IsString()
  @IsUrl()
  url: string;
}

class TestWebhookResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Webhook test successful', required: false })
  response?: string;

  @ApiProperty({ required: false })
  error?: string;
}

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('test')
  @ApiOperation({ 
    summary: 'Test webhook endpoint',
    description: 'Verify webhook access from the PlanTakeoff cluster by sending a test payload'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Webhook test completed',
    type: TestWebhookResponse
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid webhook URL' 
  })
  async testWebhook(@Body() testRequest: TestWebhookRequest): Promise<TestWebhookResponse> {
    return this.webhooksService.testWebhook(testRequest.url);
  }
}
