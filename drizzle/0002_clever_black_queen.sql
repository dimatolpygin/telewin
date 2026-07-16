-- Триграммы для устойчивости к опечаткам (оператор `<%`, функция word_similarity).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Единая нормализация имени для поиска. Используется и в GENERATED-столбце ниже,
-- и в запросе покупателя — один алгоритм на обе стороны, иначе они разъедутся.
--   1) буква|цифра разбиваются пробелом: «м5» → «м 5», «5*12» не трогается;
--   2) lower;
--   3) латинские гомоглифы сводятся в кириллицу (m→м, a→а, c→с, o→о, p→р…), чтобы
--      латинская «M» из наименования «Болт M 5*12» встала на кириллическую «м» из
--      запроса «болт м5». Направление важно: русские слова остаются кириллицей и
--      нормально стеммятся конфигурацией `russian` («саморезы» → «саморез»). Обратный
--      свод (кириллица→латиница) ломал бы стемминг почти всех слов (а,е,о,р,с…).
-- IMMUTABLE — обязательное условие, чтобы функцию можно было звать в GENERATED-столбце.
CREATE OR REPLACE FUNCTION norm_search(t text) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT translate(
		lower(regexp_replace(coalesce(t, ''), '([[:alpha:]])([0-9])|([0-9])([[:alpha:]])', '\1\3 \2\4', 'g')),
		'acekmoptxy', 'асекмортху')
$$;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "наименование_norm" text GENERATED ALWAYS AS (norm_search("наименование")) STORED;--> statement-breakpoint
CREATE INDEX "items_артикул_idx" ON "items" USING btree ("артикул");--> statement-breakpoint
CREATE INDEX "items_штрихкод_idx" ON "items" USING btree ("штрихкод");--> statement-breakpoint
CREATE INDEX "items_наим_fts_idx" ON "items" USING gin (to_tsvector('russian', "наименование_norm"));--> statement-breakpoint
CREATE INDEX "items_наим_trgm_idx" ON "items" USING gin ("наименование_norm" gin_trgm_ops);
