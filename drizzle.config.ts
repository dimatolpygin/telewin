import { defineConfig } from 'drizzle-kit';

/**
 * Конфиг drizzle-kit. Строку подключения собираем из тех же переменных,
 * что использует приложение, — чтобы миграции и код не разъехались.
 */
function требуется(имя: string): string {
  const значение = process.env[имя];
  if (значение === undefined || значение.trim() === '') {
    throw new Error(`Не задана переменная окружения ${имя} (нужна для drizzle-kit)`);
  }
  return значение;
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: требуется('POSTGRES_HOST'),
    port: Number(требуется('POSTGRES_PORT')),
    database: требуется('POSTGRES_DB'),
    user: требуется('POSTGRES_USER'),
    password: требуется('POSTGRES_PASSWORD'),
    ssl: false,
  },
});
