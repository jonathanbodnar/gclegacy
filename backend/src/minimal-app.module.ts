import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';

// Minimal app module for faster startup and health checks
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
    }),
  ],
  controllers: [HealthController],
})
export class MinimalAppModule {}
