import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { MinimalAppModule } from "./minimal-app.module";

// Global error handlers to prevent crashes
function setupGlobalErrorHandlers() {
  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
    console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
    // Don't exit - log and continue
    // Only exit if it's a critical error that we can't recover from
    if (
      reason &&
      typeof reason === "object" &&
      (reason.code === "ENOMEM" || reason.message?.includes("out of memory"))
    ) {
      console.error(
        "💥 Out of memory error detected - process may be unstable"
      );
      // Give it a moment to log, then exit gracefully
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    }
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (error: Error) => {
    console.error("❌ Uncaught Exception:", error);
    // For critical errors, exit after logging
    if (
      error.message?.includes("out of memory") ||
      error.name === "RangeError"
    ) {
      console.error("💥 Critical error - exiting process");
      process.exit(1);
    }
    // For other errors, log but continue (NestJS will handle most)
  });

  // Handle SIGTERM for graceful shutdown
  process.on("SIGTERM", () => {
    console.log("🛑 SIGTERM received - shutting down gracefully");
    process.exit(0);
  });

  // Handle SIGINT for graceful shutdown
  process.on("SIGINT", () => {
    console.log("🛑 SIGINT received - shutting down gracefully");
    process.exit(0);
  });

  // Monitor memory usage periodically (every 5 minutes)
  if (process.env.MONITOR_MEMORY !== "false") {
    setInterval(
      () => {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(usage.rss / 1024 / 1024);

        // Log if memory usage is high
        if (heapUsedMB > 400 || rssMB > 500) {
          console.warn(
            `⚠️  High memory usage: Heap ${heapUsedMB}MB/${heapTotalMB}MB, RSS ${rssMB}MB`
          );
        }

        // Force garbage collection if available (requires --expose-gc flag)
        if (global.gc && heapUsedMB > 300) {
          try {
            global.gc();
            const afterGC = process.memoryUsage();
            const afterHeapMB = Math.round(afterGC.heapUsed / 1024 / 1024);
            console.log(`🧹 GC triggered: ${heapUsedMB}MB -> ${afterHeapMB}MB`);
          } catch (e) {
            // Ignore GC errors
          }
        }
      },
      5 * 60 * 1000
    ); // Every 5 minutes
  }
}

async function bootstrap() {
  // Setup global error handlers first
  setupGlobalErrorHandlers();
  try {
    console.log("🚀 Starting PlanTakeoff API...");

    // Always start with minimal app first for health checks, then upgrade
    const useMinimalApp = process.env.MINIMAL_START !== "false";
    let AppModuleToUse = useMinimalApp ? MinimalAppModule : AppModule;

    // Try full app first, fallback to minimal if it fails
    if (!useMinimalApp) {
      try {
        console.log("Attempting to start Full App Module...");
        AppModuleToUse = AppModule;
      } catch (error) {
        console.warn(
          "Full app failed to load, falling back to minimal app:",
          error.message
        );
        AppModuleToUse = MinimalAppModule;
      }
    }

    console.log(
      `Using ${AppModuleToUse === MinimalAppModule ? "Minimal" : "Full"} App Module`
    );

    const app = await NestFactory.create(AppModuleToUse, {
      logger: ["error", "warn", "log"],
      abortOnError: false, // Don't crash on module loading errors
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    );

    // API prefix - but exclude health endpoints
    const apiPrefix = process.env.API_PREFIX || "v1";
    app.setGlobalPrefix(apiPrefix, {
      exclude: ["health", "/"], // Exclude health check and root from prefix
    });

    // CORS - allow frontend domain
    const corsOrigin = process.env.CORS_ORIGIN || "*";

    console.log("🔒 CORS configuration:", {
      origin: corsOrigin,
      credentials: true,
    });

    app.enableCors({
      origin:
        corsOrigin === "*" ? true : corsOrigin.split(",").map((o) => o.trim()),
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Accept",
        "X-Requested-With",
      ],
      exposedHeaders: ["Content-Length", "Content-Type"],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });

    // Swagger documentation (only for full app)
    if (!useMinimalApp) {
      const config = new DocumentBuilder()
        .setTitle("PlanTakeoff API")
        .setDescription(
          "AI-powered architectural/MEP plan analysis and takeoff API"
        )
        .setVersion("0.1.0")
        .addBearerAuth(
          {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
          "JWT-auth"
        )
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup("docs", app, document);
    }

    const port = process.env.PORT || 3000;
    await app.listen(port, "0.0.0.0");

    console.log(`✅ PlanTakeoff API is running on port ${port}`);
    console.log(`📚 API Documentation: http://localhost:${port}/docs`);
    console.log(`❤️  Health Check: http://localhost:${port}/health`);
    console.log(`🔗 API Endpoints: http://localhost:${port}/${apiPrefix}`);
  } catch (error) {
    console.error("❌ Failed to start PlanTakeoff API:", error);
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error("❌ Bootstrap failed:", error);
  process.exit(1);
});
