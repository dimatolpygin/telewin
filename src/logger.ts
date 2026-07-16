/**
 * Логи проекта. Требование заказчика: читаемые логи на русском, с датой и временем,
 * на каждое действие.
 *
 * pino-pretty подключён потоком, а не через `transport`, и это принципиально для
 * Windows. Транспорт уходит в worker-поток и пишет сырые UTF-8 байты прямо в
 * дескриптор 1 (sonic-boom), минуя консоль. Консоль Windows по умолчанию живёт в
 * CP866, трактует эти байты как 866 — и русский лог превращается в «╨а╨░╨╖╨▒╨╕╤А».
 * `process.stdout` же на Windows идёт через WriteConsoleW и печатает кириллицу
 * правильно, поэтому и отдаём поток явно (pino-pretty принимает его как есть,
 * см. index.js:156). В Linux и Docker разницы нет — там stdout и так UTF-8.
 */
import pino from 'pino';
import pretty from 'pino-pretty';

const поток = pretty({
  colorize: true,
  translateTime: 'dd.mm.yyyy HH:MM:ss',
  ignore: 'pid,hostname',
  destination: process.stdout,
});

export const logger = pino(
  {
    // LOG_LEVEL читаем напрямую, а не через config: логгер не должен требовать
    // пароль от Postgres, чтобы напечатать строку. Иначе CLI (например price:parse)
    // не запустится без поднятой базы.
    level: process.env.LOG_LEVEL ?? 'info',
  },
  поток,
);
