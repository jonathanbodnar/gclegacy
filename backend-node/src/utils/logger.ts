/* eslint-disable no-console */
type LogLevel = 'info' | 'error' | 'warn';

const formatMessage = (level: LogLevel, message: string) => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
};

export const logger = {
  info: (message: string, payload?: unknown) => {
    if (payload) {
      console.log(formatMessage('info', message), payload);
    } else {
      console.log(formatMessage('info', message));
    }
  },
  warn: (message: string, payload?: unknown) => {
    if (payload) {
      console.warn(formatMessage('warn', message), payload);
    } else {
      console.warn(formatMessage('warn', message));
    }
  },
  error: (message: string, payload?: unknown) => {
    if (payload) {
      console.error(formatMessage('error', message), payload);
    } else {
      console.error(formatMessage('error', message));
    }
  },
};

