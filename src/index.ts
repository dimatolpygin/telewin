/**
 * Точка входа. Этап 0 — каркас: HTTP-сервер с проверкой здоровья.
 * Каналы (VK, MAX, Telegram) и логика прайса подключаются на следующих этапах.
 */
import Fastify from 'fastify';
import { config } from './config.js';
import { logger } from './logger.js';
import { клиентPostgres, проверитьPostgres } from './db/index.js';
import { redis, проверитьRedis } from './redis.js';

const сервер = Fastify({ loggerInstance: logger });

/**
 * Проверка здоровья. Отвечает 200 только когда живы и Postgres, и Redis:
 * «здоров» без работающей базы — это враньё, а врать нельзя даже в /health.
 */
сервер.get('/health', async (запрос, ответ) => {
  const проверки = await Promise.allSettled([проверитьPostgres(), проверитьRedis()]);
  const [postgresПроверка, redisПроверка] = проверки;

  const состояние = {
    postgres: postgresПроверка?.status === 'fulfilled',
    redis: redisПроверка?.status === 'fulfilled',
  };
  const здоров = состояние.postgres && состояние.redis;

  for (const проверка of проверки) {
    if (проверка.status === 'rejected') {
      логОшибки('Проверка здоровья: зависимость недоступна', проверка.reason);
    }
  }

  logger.info(
    `Проверка здоровья: ${здоров ? 'всё в порядке' : 'ЕСТЬ ПРОБЛЕМЫ'} · ` +
      `Postgres: ${состояние.postgres ? 'на связи' : 'НЕДОСТУПЕН'} · ` +
      `Redis: ${состояние.redis ? 'на связи' : 'НЕДОСТУПЕН'}`,
  );

  return ответ.code(здоров ? 200 : 503).send({
    status: здоров ? 'ok' : 'error',
    время: new Date().toISOString(),
    зависимости: состояние,
  });
});

function логОшибки(сообщение: string, причина: unknown): void {
  logger.error(`${сообщение}: ${причина instanceof Error ? причина.message : String(причина)}`);
}

async function запустить(): Promise<void> {
  // host 0.0.0.0 обязателен: иначе снаружи контейнера порт недоступен.
  await сервер.listen({ port: config.app.port, host: '0.0.0.0' });
  logger.info(`Приложение запущено · окружение: ${config.app.env} · порт: ${config.app.port}`);
}

/** Аккуратная остановка: дать серверу дописать ответы и закрыть соединения. */
async function остановить(сигнал: string): Promise<void> {
  logger.info(`Получен сигнал ${сигнал}, останавливаюсь…`);
  try {
    await сервер.close();
    await Promise.allSettled([клиентPostgres.end(), redis.quit()]);
    logger.info('Остановлено штатно');
    process.exit(0);
  } catch (причина) {
    логОшибки('Ошибка при остановке', причина);
    process.exit(1);
  }
}

for (const сигнал of ['SIGINT', 'SIGTERM'] as const) {
  process.on(сигнал, () => void остановить(сигнал));
}

запустить().catch((причина: unknown) => {
  логОшибки('Не удалось запустить приложение', причина);
  process.exit(1);
});
