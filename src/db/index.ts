/** Подключение к Postgres через drizzle. */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { строкаПодключенияPostgres } from '../config.js';
import * as schema from './schema.js';

/** Низкоуровневый клиент — нужен для ping и для закрытия соединений при остановке. */
export const клиентPostgres = postgres(строкаПодключенияPostgres(), { max: 10 });

export const db = drizzle(клиентPostgres, { schema });

/** Проверка живости базы для /health. */
export async function проверитьPostgres(): Promise<void> {
  await клиентPostgres`select 1`;
}
