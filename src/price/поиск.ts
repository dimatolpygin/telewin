/**
 * Гибридный поиск по прайсу (этап 5). Никакого вранья: цена и остаток — из БД,
 * ИИ только помогает НАЙТИ строку, но не выдумывает числа.
 *
 * Порядок каналов, от самого доверенного:
 *   1. точное совпадение по артикулу/штрихкоду — короткозамыкает всё остальное
 *      (покупатель, назвавший артикул, хочет этот товар; и это дешевле — без вызова API);
 *   2. иначе — взвешенный скор из трёх сигналов:
 *      · вектор (семантика, qwen3-embedding-4b через OpenRouter) — основной сигнал:
 *        «гвозди сотка» находит «Гвоздь строительный 4*100», а не «Жидкие гвозди» (клей);
 *      · полнотекст (FTS `russian`) — сильный бонус за точное лексическое совпадение;
 *      · триграммы (pg_trgm) — терпимость к опечаткам.
 *
 * Вес вектора выше триграмм осознанно: на «гвозди сотка» триграммы тянут «жидкие
 * гвозди» (общее слово «гвозди»), а семантика — настоящие гвозди. Точное по артикулу
 * всегда выше семантики за счёт короткого замыкания.
 *
 * Косинус считается точным сканом (без ivfflat/hnsw): 2560 мерностей превышают лимит
 * ANN-индексов, на 12k строк это ~15 мс, и порядок строго воспроизводим.
 *
 * Если эмбеддинг запроса посчитать не удалось (API недоступен) — тихо падаем на
 * детерминированный поиск (FTS + триграммы), как на этапе 4. Наличие/цена важнее
 * семантики и не должны зависеть от внешнего сервиса.
 *
 * Результат — по товару: наименование и цена одни, остаток и свежесть — по каждой
 * точке отдельно (свежесть из `shop_state`, готово к разной дате точек на этапе 8).
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../logger.js';
import { посчитатьЭмбеддинг, вЛитералВектора } from '../ai/эмбеддинги.js';

/** Порог триграммной близости (`word_similarity`). Подобран замером на этапе 4. */
const ПОРОГ_ТРИГРАММ = 0.4;

/** Веса сигналов в итоговом скоре. Вектор — основной, триграммы — самый слабый. */
const ВЕС_ВЕКТОР = 1.0;
const ВЕС_FTS = 0.5;
const ВЕС_ТРИГРАММ = 0.35;

/** Сколько ближайших по косинусу берём в кандидаты (семантический канал). */
const ВЕКТОР_ТОП_K = 40;

/**
 * Порог косинуса для семантического канала. У qwen3 шкала сжата вверх: мусор
 * «асдфгх» даёт ~0.62, осмысленный «крепёж» ~0.76, точный «гвозди сотка» ~0.82.
 * 0.70 отсекает явную бессмыслицу (иначе на любой мусор вернули бы 40 случайных
 * товаров), а осмысленные широкие запросы пропускает. Замер на боевом прайсе.
 */
const ПОРОГ_ВЕКТОР = 0.7;

/** Сколько товаров максимум возвращаем по одному запросу. */
const ПРЕДЕЛ_ПО_УМОЛЧАНИЮ = 20;

/** Как именно нашёлся товар — для честности вывода и отладки. */
export type СпособСовпадения = 'артикул' | 'штрихкод' | 'название' | 'смысл' | 'похоже';

export interface ОстатокТочки {
  код: string;
  магазин: string;
  остаток: string;
  /** Свежесть данных этой точки: момент выгрузки прайса, из которого взят остаток. */
  данныеОт: Date | null;
}

export interface РезультатПоиска {
  наименование: string;
  артикул: string | null;
  штрихкод: string | null;
  единица: string | null;
  цена: string;
  остатокОбщий: string;
  способ: СпособСовпадения;
  точки: ОстатокТочки[];
}

/** Одна строка сырого ответа БД: товар, размноженный по точкам. */
interface СтрокаОтвета {
  id: number;
  наименование: string;
  артикул: string | null;
  штрихкод: string | null;
  единица: string | null;
  цена: string;
  остаток_общий: string;
  способ: СпособСовпадения;
  shop_код: string;
  shop_название: string;
  остаток: string;
  данные_от: Date | null;
}

const ТЕКУЩИЕ_ИМПОРТЫ = sql`(select distinct текущий_import_id from shop_state)`;

export async function искать(
  запрос: string,
  предел = ПРЕДЕЛ_ПО_УМОЛЧАНИЮ,
): Promise<РезультатПоиска[]> {
  const текст = запрос.trim();
  if (текст === '') return [];

  // 1. Точное совпадение по артикулу/штрихкоду — короткозамыкает и не требует API.
  const точные = await точноеСовпадение(текст, предел);
  if (точные.length > 0) return группировать(точные);

  // 2. Семантика: эмбеддинг запроса. Не вышло — падаем на лексический поиск.
  let вектор: number[] | null = null;
  try {
    вектор = await посчитатьЭмбеддинг(текст);
  } catch (причина) {
    logger.warn(
      `Эмбеддинг запроса не посчитан, семантику пропускаю: ${причина instanceof Error ? причина.message : String(причина)}`,
    );
  }

  const строки =
    вектор === null
      ? await лексическийПоиск(текст, предел)
      : await гибридныйПоиск(текст, вектор, предел);

  return группировать(строки);
}

/** Точное совпадение по артикулу/штрихкоду. Возвращает строки (товар × точка). */
async function точноеСовпадение(текст: string, предел: number): Promise<СтрокаОтвета[]> {
  const результат = await db.execute(sql`
    with picked as (
      select i.id, i.import_id, i.наименование, i.артикул, i.штрихкод, i.единица,
             i.цена, i.остаток_общий, i.строка,
             case when i.артикул = ${текст} then 'артикул' else 'штрихкод' end as способ
      from items i
      where i.import_id in ${ТЕКУЩИЕ_ИМПОРТЫ}
        and (i.артикул = ${текст} or i.штрихкод = ${текст})
      order by i.строка
      limit ${предел}
    )
    ${хвостОстатков(sql`order by p.строка, s.id`)}
  `);
  return результат as unknown as СтрокаОтвета[];
}

/** Гибрид: вектор + FTS + триграммы. Порог триграмм и jit — на одну транзакцию. */
async function гибридныйПоиск(
  текст: string,
  вектор: number[],
  предел: number,
): Promise<СтрокаОтвета[]> {
  const литерал = вЛитералВектора(вектор);
  return await db.transaction(async (тр) => {
    await тр.execute(sql`set local pg_trgm.word_similarity_threshold = ${sql.raw(String(ПОРОГ_ТРИГРАММ))}`);
    await тр.execute(sql`set local jit = off`);

    const результат = await тр.execute(sql`
      with q as (
        select norm_search(${текст}) as qn,
               plainto_tsquery('russian', norm_search(${текст})) as tq
      ),
      qv as (select ${литерал}::vector as v),
      vec as (
        select i.id, (1 - (e.вектор <=> (select v from qv))) as cos
        from items i
        join эмбеддинги e on e.наименование = i.наименование
        where i.import_id in ${ТЕКУЩИЕ_ИМПОРТЫ}
          and (e.вектор <=> (select v from qv)) <= ${sql.raw(String(1 - ПОРОГ_ВЕКТОР))}
        order by e.вектор <=> (select v from qv)
        limit ${ВЕКТОР_ТОП_K}
      ),
      base as (
        select i.id, i.import_id, i.наименование, i.артикул, i.штрихкод, i.единица,
               i.цена, i.остаток_общий, i.строка,
               (to_tsvector('russian', i.наименование_norm) @@ (select tq from q)) as fts_hit,
               word_similarity((select qn from q), i.наименование_norm) as trg,
               v.cos as cos,
               (v.id is not null) as vec_hit
        from items i
        left join vec v on v.id = i.id
        where i.import_id in ${ТЕКУЩИЕ_ИМПОРТЫ}
          and ( to_tsvector('russian', i.наименование_norm) @@ (select tq from q)
                or (select qn from q) <% i.наименование_norm
                or v.id is not null )
      ),
      cand as (
        select *,
               (${sql.raw(String(ВЕС_ВЕКТОР))} * coalesce(cos, 0)
                + ${sql.raw(String(ВЕС_FTS))} * (fts_hit)::int
                + ${sql.raw(String(ВЕС_ТРИГРАММ))} * trg) as score,
               case when fts_hit then 'название'
                    when vec_hit then 'смысл'
                    else 'похоже' end as способ
        from base
      ),
      picked as (
        select * from cand
        order by score desc, строка
        limit ${предел}
      )
      ${хвостОстатков(sql`order by p.score desc, p.строка, s.id`)}
    `);
    return результат as unknown as СтрокаОтвета[];
  });
}

/** Лексический поиск (FTS + триграммы) — фолбэк, когда эмбеддинг недоступен. */
async function лексическийПоиск(текст: string, предел: number): Promise<СтрокаОтвета[]> {
  return await db.transaction(async (тр) => {
    await тр.execute(sql`set local pg_trgm.word_similarity_threshold = ${sql.raw(String(ПОРОГ_ТРИГРАММ))}`);
    await тр.execute(sql`set local jit = off`);

    const результат = await тр.execute(sql`
      with q as (
        select norm_search(${текст}) as qn,
               plainto_tsquery('russian', norm_search(${текст})) as tq
      ),
      base as (
        select i.id, i.import_id, i.наименование, i.артикул, i.штрихкод, i.единица,
               i.цена, i.остаток_общий, i.строка,
               (to_tsvector('russian', i.наименование_norm) @@ (select tq from q)) as fts_hit,
               word_similarity((select qn from q), i.наименование_norm) as trg
        from items i
        where i.import_id in ${ТЕКУЩИЕ_ИМПОРТЫ}
          and ( to_tsvector('russian', i.наименование_norm) @@ (select tq from q)
                or (select qn from q) <% i.наименование_norm )
      ),
      cand as (
        select *,
               (${sql.raw(String(ВЕС_FTS))} * (fts_hit)::int + ${sql.raw(String(ВЕС_ТРИГРАММ))} * trg) as score,
               case when fts_hit then 'название' else 'похоже' end as способ
        from base
      ),
      picked as (
        select * from cand
        order by score desc, строка
        limit ${предел}
      )
      ${хвостОстатков(sql`order by p.score desc, p.строка, s.id`)}
    `);
    return результат as unknown as СтрокаОтвета[];
  });
}

/**
 * Общий хвост: из отобранных товаров (CTE `picked`) достаём остаток и свежесть по
 * каждой точке. Точка показывается, только если её текущий импорт — тот же, что у
 * товара (свежесть по каждой точке отдельно, готово к этапу 8).
 */
function хвостОстатков(порядок: ReturnType<typeof sql>) {
  return sql`
    select p.id, p.наименование, p.артикул, p.штрихкод, p.единица, p.цена,
           p.остаток_общий, p.способ,
           s.код as shop_код, s.название as shop_название,
           st.остаток, ss.данные_от
    from picked p
    join stock st on st.item_id = p.id
    join shop_state ss on ss.текущий_import_id = p.import_id and ss.shop_id = st.shop_id
    join shops s on s.id = st.shop_id
    ${порядок}
  `;
}

/** Схлопываем (товар × точка) в один товар с массивом точек. */
function группировать(строки: СтрокаОтвета[]): РезультатПоиска[] {
  const поId = new Map<number, РезультатПоиска>();
  for (const строка of строки) {
    let товар = поId.get(строка.id);
    if (товар === undefined) {
      товар = {
        наименование: строка.наименование,
        артикул: строка.артикул,
        штрихкод: строка.штрихкод,
        единица: строка.единица,
        цена: строка.цена,
        остатокОбщий: строка.остаток_общий,
        способ: строка.способ,
        точки: [],
      };
      поId.set(строка.id, товар);
    }
    товар.точки.push({
      код: строка.shop_код,
      магазин: строка.shop_название,
      остаток: строка.остаток,
      данныеОт: строка.данные_от,
    });
  }
  return [...поId.values()];
}
