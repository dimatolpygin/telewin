/**
 * Логи проекта. Требование заказчика: читаемые логи на русском, с датой и временем,
 * на каждое действие.
 */
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.app.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'dd.mm.yyyy HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});
