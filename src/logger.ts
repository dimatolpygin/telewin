/**
 * Логи проекта. Требование заказчика: читаемые логи на русском, с датой и временем,
 * на каждое действие.
 */
import pino from 'pino';

export const logger = pino({
  // LOG_LEVEL читаем напрямую, а не через config: логгер не должен требовать
  // пароль от Postgres, чтобы напечатать строку. Иначе CLI (например price:parse)
  // не запустится без поднятой базы.
  level: process.env.LOG_LEVEL ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'dd.mm.yyyy HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});
