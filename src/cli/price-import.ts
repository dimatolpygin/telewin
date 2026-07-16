/**
 * CLI: `npm run price:import -- <файл>`
 *
 * Грузит прайс в базу. Отбитый файл — это не сбой команды, а нормальный
 * результат работы («мусор не пустили»), поэтому код выхода 0 только у удачной
 * загрузки, а у отбоя — 2: автоматике этапа 3 надо их различать.
 */
import { импортироватьПрайс } from '../price/импорт.js';
import { ОшибкаПрайса } from '../price/ошибки.js';
import { клиентPostgres } from '../db/index.js';
import { logger } from '../logger.js';

async function главная(): Promise<number> {
  const путь = process.argv[2];
  if (путь === undefined || путь.trim() === '') {
    console.error('Укажите файл прайса: npm run price:import -- "samples/boevoy_прайс_2026-07-08.xls"');
    return 1;
  }

  logger.info(`Импортирую прайс: ${путь}`);
  const начало = Date.now();
  const итог = await импортироватьПрайс(путь);
  const занято = Date.now() - начало;

  if (итог.исход === 'дубль') {
    logger.info(
      `Этот файл уже обрабатывали — импорт #${итог.importId} (${итог.файл}), статус «${итог.статус}». ` +
        'Ничего не делаю: сверка идёт по хешу содержимого, а не по имени.',
    );
    return 0;
  }

  if (итог.исход === 'отбит') {
    logger.error(`Импорт #${итог.importId} ОТБИТ: ${итог.причина}`);
    logger.error('В базу ничего не записано, указатель «текущий» не сдвинут — бот отвечает по прошлому прайсу.');
    return 2;
  }

  logger.info(
    `Импорт #${итог.importId} загружен за ${занято} мс · позиций: ${итог.позиций.toLocaleString('ru-RU')} · ` +
      `строк остатков: ${итог.остатков.toLocaleString('ru-RU')} · указатель «текущий» переключён`,
  );
  return 0;
}

главная()
  .then(async (код) => {
    await клиентPostgres.end();
    process.exit(код);
  })
  .catch(async (причина: unknown) => {
    if (причина instanceof ОшибкаПрайса) {
      logger.error(`Не удалось разобрать прайс: ${причина.message}`);
      if (причина.подсказка !== undefined) logger.error(`Подсказка: ${причина.подсказка}`);
    } else {
      logger.error(`Непредвиденная ошибка: ${причина instanceof Error ? причина.stack : String(причина)}`);
    }
    await клиентPostgres.end();
    process.exit(1);
  });
