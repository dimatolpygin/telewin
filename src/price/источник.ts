/**
 * Источник прайса — откуда бот берёт файл. За одним интерфейсом прячутся FTP и
 * локальная папка.
 *
 * Почему абстракция, а не просто FTP-клиент: клиент прямо просил «возможность
 * менять адрес сервера» и рассматривает свой FTP; приём файла он может забрать
 * себе целиком («как она туда попадёт — уже моя задача»). Для бота это должно
 * быть сменой одной строки в `.env`, а не правкой кода. Локальная папка нужна и
 * для разработки, и на случай, если файл кладут рядом.
 *
 * Конфиг читаем здесь, а не в общем config.ts: те переменные (Postgres, Redis)
 * нужны всем командам, а адрес FTP — только забору. Валидируем ровно то, что
 * требует выбранный источник, чтобы `price:import` не падал из-за пустого
 * PRICE_FTP_HOST.
 */
import { createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, type FileInfo } from 'basic-ftp';
import { logger } from '../logger.js';

/** Один файл в источнике — без содержимого, только метаданные для отбора. */
export interface ФайлИсточника {
  имя: string;
  размер: number;
  /** Момент изменения по данным источника. Для FTP — UTC. null, если неизвестен. */
  изменён: Date | null;
}

export interface ИсточникПрайса {
  /** Короткое имя вида для логов: «FTP» или «локальная папка». */
  readonly вид: string;
  /** Человекочитаемый адрес для логов — БЕЗ пароля. */
  readonly адрес: string;
  список(): Promise<ФайлИсточника[]>;
  скачать(имя: string, кудаПуть: string): Promise<void>;
  удалить(имя: string): Promise<void>;
  закрыть(): Promise<void>;
}

function env(имя: string): string | undefined {
  const значение = process.env[имя];
  return значение === undefined || значение.trim() === '' ? undefined : значение.trim();
}

function требуется(имя: string): string {
  const значение = env(имя);
  if (значение === undefined) {
    throw new Error(`Не задана переменная окружения ${имя} — она нужна для выбранного источника прайса.`);
  }
  return значение;
}

// --- FTP ---

/**
 * FTP-источник. Соединение поднимается лениво при первом обращении и держится
 * до `закрыть()`. basic-ftp работает пассивным режимом по умолчанию — под него
 * на сервере открыт диапазон 40000-40100.
 */
class FtpИсточник implements ИсточникПрайса {
  readonly вид = 'FTP';
  private readonly клиент = new Client(30_000);
  private подключён = false;

  constructor(
    private readonly настройки: {
      host: string;
      port: number;
      user: string;
      password: string;
      secure: boolean;
      dir: string;
    },
  ) {}

  get адрес(): string {
    const { user, host, port, dir } = this.настройки;
    return `ftp://${user}@${host}:${port}/${dir}`;
  }

  private async соединение(): Promise<Client> {
    if (this.подключён) return this.клиент;
    const { host, port, user, password, secure } = this.настройки;
    await this.клиент.access({ host, port, user, password, secure });
    this.подключён = true;
    return this.клиент;
  }

  async список(): Promise<ФайлИсточника[]> {
    const клиент = await this.соединение();
    const файлы = await клиент.list(this.настройки.dir);
    return файлы
      .filter((ф: FileInfo) => ф.isFile)
      .map((ф: FileInfo) => ({
        имя: ф.name,
        размер: ф.size,
        // modifiedAt приходит из MLSD и уже в UTC. rawModifiedAt (из LIST) —
        // запасной вариант, но у него нет года при старых датах, так что верим
        // сначала modifiedAt.
        изменён: ф.modifiedAt ?? null,
      }));
  }

  async скачать(имя: string, кудаПуть: string): Promise<void> {
    const клиент = await this.соединение();
    await клиент.downloadTo(createWriteStream(кудаПуть), `${this.настройки.dir}/${имя}`);
  }

  async удалить(имя: string): Promise<void> {
    const клиент = await this.соединение();
    await клиент.remove(`${this.настройки.dir}/${имя}`);
  }

  async закрыть(): Promise<void> {
    if (this.подключён) this.клиент.close();
    this.подключён = false;
  }
}

// --- Локальная папка ---

/** Локальная папка. Тот же интерфейс, что и FTP: разработка и «файл кладут рядом». */
class ЛокальныйИсточник implements ИсточникПрайса {
  readonly вид = 'локальная папка';

  constructor(private readonly папка: string) {}

  get адрес(): string {
    return this.папка;
  }

  async список(): Promise<ФайлИсточника[]> {
    const имена = await readdir(this.папка);
    const итог: ФайлИсточника[] = [];
    for (const имя of имена) {
      const инфо = await stat(join(this.папка, имя));
      if (инфо.isFile()) итог.push({ имя, размер: инфо.size, изменён: инфо.mtime });
    }
    return итог;
  }

  async скачать(имя: string, кудаПуть: string): Promise<void> {
    // «Скачивание» из локальной папки — копирование, чтобы дальше по коду путь
    // был единым (импортёр работает с локальным файлом в любом случае).
    const { copyFile } = await import('node:fs/promises');
    await copyFile(join(this.папка, имя), кудаПуть);
  }

  async удалить(имя: string): Promise<void> {
    await unlink(join(this.папка, имя));
  }

  async закрыть(): Promise<void> {
    // Нечего закрывать.
  }
}

// --- Фабрика ---

export interface НастройкиЗабора {
  /** Сколько ждать между двумя замерами размера, проверяя, что файл дозалит (мс). */
  ожиданиеСтабильностиМс: number;
  /** Сколько свежих файлов оставлять в источнике при авто-очистке. 0 — не чистить. */
  хранитьФайлов: number;
}

export function настройкиЗабора(): НастройкиЗабора {
  return {
    ожиданиеСтабильностиМс: Number(env('PRICE_STABLE_WAIT_MS') ?? 3000),
    хранитьФайлов: Number(env('PRICE_KEEP_FILES') ?? 0),
  };
}

/**
 * Собрать источник по `.env`. `PRICE_SOURCE` = `ftp` (по умолчанию) или `local`.
 * Обращается только к тем переменным, что нужны выбранному виду.
 */
export function создатьИсточник(): ИсточникПрайса {
  const вид = (env('PRICE_SOURCE') ?? 'ftp').toLowerCase();

  if (вид === 'local' || вид === 'локальная') {
    return new ЛокальныйИсточник(требуется('PRICE_LOCAL_DIR'));
  }

  if (вид === 'ftp') {
    const источник = new FtpИсточник({
      host: требуется('PRICE_FTP_HOST'),
      port: Number(env('PRICE_FTP_PORT') ?? 21),
      user: требуется('PRICE_FTP_USER'),
      password: требуется('PRICE_FTP_PASSWORD'),
      secure: (env('PRICE_FTP_SECURE') ?? 'false').toLowerCase() === 'true',
      dir: env('PRICE_FTP_DIR') ?? 'price',
    });
    logger.debug(`Источник прайса: FTP ${источник.адрес}`);
    return источник;
  }

  throw new Error(`Неизвестный PRICE_SOURCE=«${вид}». Допустимо: ftp | local.`);
}
