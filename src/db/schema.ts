/**
 * Схема БД (Drizzle).
 *
 * Этап 0 — только служебная таблица: она подтверждает, что миграции реально
 * применяются. Рабочие таблицы прайса (shops, imports, items, stock) появятся
 * на этапе 2, см. docs/ROADMAP.md.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Служебный словарь «ключ-значение» для отметок приложения. */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
