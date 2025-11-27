import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes';
import { config } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
export const buildApp = () => {
  const app = express();

  const staticFrontend = 'https://gclegacy-2.onrender.com';

  const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow non-browser tools like Postman (no origin)
      if (!origin) return callback(null, true);

      const allowed = config.allowedOrigins.includes('*')
        ? true
        : [...config.allowedOrigins, staticFrontend].includes(origin);

      if (allowed) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };

  app.use(cors(corsOptions));
  app.use(helmet());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('dev'));

  app.use(config.apiPrefix, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};


