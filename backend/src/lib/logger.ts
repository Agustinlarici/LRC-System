import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  isDev
    ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }
    : { level: 'info' }
);
