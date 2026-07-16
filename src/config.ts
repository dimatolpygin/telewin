/**
 * Чтение и проверка переменных окружения.
 *
 * Падаем на старте, если переменной нет: лучше не подняться вообще, чем
 * молча работать с пустым паролем к базе.
 */

function требуется(имя: string): string {
  const значение = process.env[имя];
  if (значение === undefined || значение.trim() === '') {
    throw new Error(
      `Не задана переменная окружения ${имя}. Скопируйте .env.example в .env и заполните.`,
    );
  }
  return значение;
}

function число(имя: string): number {
  const сырое = требуется(имя);
  const значение = Number(сырое);
  if (!Number.isInteger(значение) || значение <= 0) {
    throw new Error(`Переменная ${имя} должна быть целым числом больше нуля, получено: ${сырое}`);
  }
  return значение;
}

const postgres = {
  host: требуется('POSTGRES_HOST'),
  port: число('POSTGRES_PORT'),
  database: требуется('POSTGRES_DB'),
  user: требуется('POSTGRES_USER'),
  password: требуется('POSTGRES_PASSWORD'),
};

export const config = {
  app: {
    port: число('APP_PORT'),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    env: process.env.NODE_ENV ?? 'development',
  },
  postgres,
  redis: {
    host: требуется('REDIS_HOST'),
    port: число('REDIS_PORT'),
  },
};

/** Строка подключения к Postgres. Пароль экранируем — в нём могут быть спецсимволы. */
export function строкаПодключенияPostgres(): string {
  const { user, password, host, port, database } = postgres;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}
