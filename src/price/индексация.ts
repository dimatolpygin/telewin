/**
 * Индексация эмбеддингов текущего снимка (этап 5).
 *
 * Считаем векторы только для наименований текущего импорта, которых ещё нет в
 * кеше `эмбеддинги`. Снимок приходит целиком на каждый импорт, но имена почти не
 * меняются, поэтому переимпорт переиспользует уже посчитанное, а OpenRouter
 * дёргается лишь на новые имена. Ключ кеша — исходное наименование.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { эмбеддинги } from '../db/schema.js';
import { logger } from '../logger.js';
import { модельЭмбеддингов, посчитатьЭмбеддинги } from '../ai/эмбеддинги.js';

/** Сколько строк вставляем в БД за раз. */
const ВСТАВКА_ЗА_РАЗ = 500;

export interface ИтогИндексации {
  всегоИмён: number;
  посчитано: number;
  ужеБыло: number;
}

/** Наименования текущего снимка, которых ещё нет в кеше эмбеддингов. */
async function ненайденныеИмена(): Promise<string[]> {
  const строки = await db.execute<{ наименование: string }>(sql`
    select distinct i.наименование
    from items i
    where i.import_id in (select distinct текущий_import_id from shop_state)
      and not exists (select 1 from эмбеддинги e where e.наименование = i.наименование)
    order by i.наименование
  `);
  return (строки as unknown as { наименование: string }[]).map((р) => р.наименование);
}

/** Сколько всего разных имён в текущем снимке (для отчёта). */
async function всегоИмён(): Promise<number> {
  const [строка] = (await db.execute<{ n: number }>(sql`
    select count(distinct i.наименование)::int as n
    from items i
    where i.import_id in (select distinct текущий_import_id from shop_state)
  `)) as unknown as { n: number }[];
  return строка?.n ?? 0;
}

export async function проиндексироватьЭмбеддинги(): Promise<ИтогИндексации> {
  const всего = await всегоИмён();
  const имена = await ненайденныеИмена();

  if (имена.length === 0) {
    logger.info(`Эмбеддинги: все ${всего} наименований уже в кеше, считать нечего`);
    return { всегоИмён: всего, посчитано: 0, ужеБыло: всего };
  }

  logger.info(`Эмбеддинги: считаю ${имена.length} новых наименований из ${всего}`);
  const модель = модельЭмбеддингов();
  const векторы = await посчитатьЭмбеддинги(имена);

  let посчитано = 0;
  for (let начало = 0; начало < имена.length; начало += ВСТАВКА_ЗА_РАЗ) {
    const срез = имена.slice(начало, начало + ВСТАВКА_ЗА_РАЗ);
    const значения = срез.map((наименование, i) => ({
      наименование,
      модель,
      вектор: векторы[начало + i]!,
    }));
    await db.insert(эмбеддинги).values(значения).onConflictDoNothing({ target: эмбеддинги.наименование });
    посчитано += срез.length;
    logger.debug(`Эмбеддинги записаны: ${посчитано} из ${имена.length}`);
  }

  return { всегоИмён: всего, посчитано, ужеБыло: всего - имена.length };
}
