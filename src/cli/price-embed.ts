/**
 * CLI: `npm run price:embed`
 *
 * Считает эмбеддинги для наименований текущего снимка, которых ещё нет в кеше.
 * Запускать после импорта нового прайса — семантический поиск (этап 5) опирается
 * на эту таблицу. Повторный запуск ничего не пересчитывает, если имена не менялись.
 */
import { проиндексироватьЭмбеддинги } from '../price/индексация.js';
import { клиентPostgres } from '../db/index.js';
import { logger } from '../logger.js';

async function главная(): Promise<number> {
  const начато = Date.now();
  const итог = await проиндексироватьЭмбеддинги();
  const сек = ((Date.now() - начато) / 1000).toFixed(1);

  console.log('');
  console.log(
    `Эмбеддинги готовы: посчитано ${итог.посчитано}, уже было ${итог.ужеБыло}, ` +
      `всего наименований ${итог.всегоИмён} (${сек} с).`,
  );
  console.log('');
  return 0;
}

главная()
  .then(async (код) => {
    await клиентPostgres.end();
    process.exit(код);
  })
  .catch(async (причина: unknown) => {
    logger.error(`Индексация эмбеддингов не удалась: ${причина instanceof Error ? причина.message : String(причина)}`);
    await клиентPostgres.end();
    process.exit(1);
  });
