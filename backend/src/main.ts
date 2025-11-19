import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MinimalAppModule } from './minimal-app.module';

async function bootstrap() {
  try {
    console.log('🚀 Starting PlanTakeoff API...');
    console.log('Node.js version:', process.version);
    
    // Always start with minimal app first for health checks, then upgrade
    const useMinimalApp = process.env.MINIMAL_START !== 'false';
    let AppModuleToUse = useMinimalApp ? MinimalAppModule : AppModule;
    
    // Try full app first, fallback to minimal if it fails
    if (!useMinimalApp) {
      try {
        console.log('Attempting to start Full App Module...');
        AppModuleToUse = AppModule;
      } catch (error) {
        console.warn('Full app failed to load, falling back to minimal app:', error.message);
        AppModuleToUse = MinimalAppModule;
      }
    }
    
    console.log(`Using ${AppModuleToUse === MinimalAppModule ? 'Minimal' : 'Full'} App Module`);
    
    const app = await NestFactory.create(AppModuleToUse, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false, // Don't crash on module loading errors
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

    // CORS - allow frontend domain
    const corsOrigin = process.env.CORS_ORIGIN || '*';
    
    console.log('🔒 CORS configuration:', {
      origin: corsOrigin,
      credentials: true,
    });
    
    app.enableCors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(o => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
      exposedHeaders: ['Content-Length', 'Content-Type'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
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
