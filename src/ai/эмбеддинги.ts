/**
 * Эмбеддинги через OpenRouter (`POST /api/v1/embeddings`).
 *
 * Модель по умолчанию — `google/gemini-embedding-001` (3072 мерности). Выбрана
 * замером на боевых именах из прайса: проходит оба тяжёлых запроса — «гвозди сотка»
 * (настоящие гвозди выше «жидких гвоздей»-клея) и «крепёж» (болты/гайки/саморезы выше
 * мусора). text-embedding-3-small/large и bge-m3 ставили клей выше цели, qwen3 —
 * мусор выше крепежа. Детерминирована (один текст → тот же вектор). Подробности —
 * в `docs/PROJECT.md` (ADR).
 *
 * Конфиг читаем лениво из env, а не из общего `config.ts`: иначе CLI, которым ключ
 * не нужен (`price:parse`, `price:import`), падали бы на старте без него.
 */
import { logger } from '../logger.js';

/** Сколько текстов шлём в один запрос. Имена товаров короткие, но не жадничаем. */
const РАЗМЕР_БАТЧА = 64;

interface НастройкиЭмбеддингов {
  ключ: string;
  базовыйURL: string;
  модель: string;
  мерность: number;
}

function настройки(): НастройкиЭмбеддингов {
  const ключ = process.env.OPENROUTER_API_KEY;
  if (ключ === undefined || ключ.trim() === '') {
    throw new Error(
      'Не задан OPENROUTER_API_KEY — он нужен для подсчёта эмбеддингов (этап 5). ' +
        'Заполните .env (ключ в доступы.txt).',
    );
  }
  return {
    ключ: ключ.trim(),
    базовыйURL: (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    модель: process.env.EMBEDDING_MODEL ?? 'google/gemini-embedding-001',
    мерность: Number(process.env.EMBEDDING_DIM ?? '3072'),
  };
}

/** Мерность вектора из конфига — под неё заведён столбец `vector(N)` в БД. */
export function мерностьЭмбеддинга(): number {
  return Number(process.env.EMBEDDING_DIM ?? '3072');
}

/** Название модели — для журналов и метки в кеше эмбеддингов. */
export function модельЭмбеддингов(): string {
  return process.env.EMBEDDING_MODEL ?? 'google/gemini-embedding-001';
}

interface ОтветЭмбеддингов {
  data?: { embedding: number[]; index: number }[];
  error?: { message?: string };
}

async function запроситьБатч(тексты: string[], н: НастройкиЭмбеддингов): Promise<number[][]> {
  const ответ = await fetch(`${н.базовыйURL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${н.ключ}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: н.модель, input: тексты }),
  });

  if (!ответ.ok) {
    const тело = await ответ.text();
    throw new Error(`OpenRouter embeddings вернул ${ответ.status}: ${тело.slice(0, 300)}`);
  }

  const json = (await ответ.json()) as ОтветЭмбеддингов;
  if (json.error) {
    throw new Error(`OpenRouter embeddings: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  if (!json.data || json.data.length !== тексты.length) {
    throw new Error(
      `OpenRouter embeddings вернул ${json.data?.length ?? 0} векторов на ${тексты.length} текстов`,
    );
  }

  // Порядок не гарантирован API — раскладываем по полю index.
  const векторы: number[][] = new Array(тексты.length);
  for (const item of json.data) {
    if (item.embedding.length !== н.мерность) {
      throw new Error(
        `Модель ${н.модель} вернула вектор мерности ${item.embedding.length}, ожидалось ${н.мерность}. ` +
          'Проверьте EMBEDDING_DIM и столбец vector(N) в БД.',
      );
    }
    векторы[item.index] = item.embedding;
  }
  return векторы;
}

/**
 * Посчитать эмбеддинги для списка текстов. Возвращает векторы в том же порядке.
 * Бьёт на батчи, чтобы не упереться в лимиты запроса.
 */
export async function посчитатьЭмбеддинги(тексты: string[]): Promise<number[][]> {
  if (тексты.length === 0) return [];
  const н = настройки();
  const итог: number[][] = [];

  for (let начало = 0; начало < тексты.length; начало += РАЗМЕР_БАТЧА) {
    const батч = тексты.slice(начало, начало + РАЗМЕР_БАТЧА);
    const векторы = await запроситьБатч(батч, н);
    итог.push(...векторы);
    logger.debug(`Эмбеддинги: ${Math.min(начало + РАЗМЕР_БАТЧА, тексты.length)} из ${тексты.length}`);
  }

  return итог;
}

/** Посчитать эмбеддинг одного текста (запрос покупателя). */
export async function посчитатьЭмбеддинг(текст: string): Promise<number[]> {
  const [вектор] = await посчитатьЭмбеддинги([текст]);
  return вектор!;
}

/** Литерал pgvector: `[0.1,0.2,...]`. Формат, который принимает тип `vector`. */
export function вЛитералВектора(вектор: number[]): string {
  return `[${вектор.join(',')}]`;
}
