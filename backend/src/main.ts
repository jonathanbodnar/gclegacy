import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MinimalAppModule } from './minimal-app.module';

async function bootstrap() {
  try {
    console.log('🚀 Starting PlanTakeoff API...');
    
    // Use minimal app for faster health check availability
    const useMinimalApp = process.env.MINIMAL_START === 'true';
    const AppModuleToUse = useMinimalApp ? MinimalAppModule : AppModule;
    
    console.log(`Using ${useMinimalApp ? 'Minimal' : 'Full'} App Module`);
    
    const app = await NestFactory.create(AppModuleToUse, {
      logger: ['error', 'warn', 'log'],
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    // API prefix - but exclude health endpoints
    const apiPrefix = process.env.API_PREFIX || 'v1';
    app.setGlobalPrefix(apiPrefix, {
      exclude: ['health', '/'] // Exclude health check and root from prefix
    });

    // CORS
    app.enableCors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      credentials: true,
    });

    // Swagger documentation (only for full app)
    if (!useMinimalApp) {
      const config = new DocumentBuilder()
        .setTitle('PlanTakeoff API')
        .setDescription('AI-powered architectural/MEP plan analysis and takeoff API')
        .setVersion('0.1.0')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          'JWT-auth',
        )
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('docs', app, document);
    }

    const port = process.env.PORT || 3000;
    await app.listen(port);
    
    console.log(`✅ PlanTakeoff API is running on port ${port}`);
    console.log(`📚 API Documentation: http://localhost:${port}/docs`);
    console.log(`❤️  Health Check: http://localhost:${port}/health`);
    console.log(`🔗 API Endpoints: http://localhost:${port}/${apiPrefix}`);
  } catch (error) {
    console.error('❌ Failed to start PlanTakeoff API:', error);
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('❌ Bootstrap failed:', error);
  process.exit(1);
});
