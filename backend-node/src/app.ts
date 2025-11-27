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

  const corsOptions = {
    origin: config.allowedOrigins.includes('*')
      ? true
      : config.allowedOrigins,
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

