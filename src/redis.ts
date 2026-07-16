/** Подключение к Redis (память диалога, очереди, дебаунс — со следующих этапов). */
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  // Не заваливаем лог бесконечными попытками, но и не сдаёмся сразу:
  // Redis может подняться чуть позже приложения.
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

/** Проверка живости Redis для /health. */
export async function проверитьRedis(): Promise<void> {
  const ответ = await redis.ping();
  if (ответ !== 'PONG') {
    throw new Error(`Redis ответил «${ответ}» вместо PONG`);
  }
}
