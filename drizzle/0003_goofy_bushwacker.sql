-- pgvector: тип `vector` для семантического поиска (этап 5). Образ postgres —
-- pgvector/pgvector:pg16, расширение в нём есть, остаётся его включить.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "эмбеддинги" (
	"наименование" text PRIMARY KEY NOT NULL,
	"модель" text NOT NULL,
	"вектор" vector(2560) NOT NULL,
	"создан" timestamp with time zone DEFAULT now() NOT NULL
);
