import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'plantakeoff-api',
      version: '0.1.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid
    };
  }

  @Get()
  root() {
    return { 
      message: 'PlanTakeoff API is running',
      docs: '/docs',
      health: '/health',
      api: '/v1'
    };
  }

  @Get('ping')
  ping() {
    return 'pong';
  }
}
