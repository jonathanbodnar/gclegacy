import mongoose from 'mongoose';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export const connectDatabase = async (): Promise<typeof mongoose> => {
  mongoose.set('strictQuery', true);
  try {
    const connection = await mongoose.connect(config.mongoUri);
    logger.info('Connected to MongoDB');
    return connection;
  } catch (error) {
    logger.error('Failed to connect to MongoDB', error);
    throw error;
  }
};

