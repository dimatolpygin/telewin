CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"файл" text NOT NULL,
	"хеш" text NOT NULL,
	"размер_байт" integer NOT NULL,
	"раскладка" text NOT NULL,
	"статус" text NOT NULL,
	"причина_отказа" text,
	"позиций" integer NOT NULL,
	"файл_от" timestamp with time zone,
	"создан" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"строка" integer NOT NULL,
	"штрихкод" text,
	"артикул" text,
	"наименование" text NOT NULL,
	"единица" text,
	"производитель" text,
	"цена" numeric(12, 2) NOT NULL,
	"остаток_общий" numeric(14, 3) NOT NULL,
	"категория" text,
	"вид_товара" text
);
--> statement-breakpoint
CREATE TABLE "shop_state" (
	"shop_id" integer PRIMARY KEY NOT NULL,
	"текущий_import_id" integer NOT NULL,
	"данные_от" timestamp with time zone,
	"обновлён" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" serial PRIMARY KEY NOT NULL,
	"код" text NOT NULL,
	"название" text NOT NULL,
	CONSTRAINT "shops_код_unique" UNIQUE("код")
);
--> statement-breakpoint
CREATE TABLE "stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"остаток" numeric(14, 3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_state" ADD CONSTRAINT "shop_state_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_state" ADD CONSTRAINT "shop_state_текущий_import_id_imports_id_fk" FOREIGN KEY ("текущий_import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imports_хеш_uq" ON "imports" USING btree ("хеш");--> statement-breakpoint
CREATE INDEX "items_import_id_idx" ON "items" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_item_shop_uq" ON "stock" USING btree ("item_id","shop_id");--> statement-breakpoint
CREATE INDEX "stock_import_shop_idx" ON "stock" USING btree ("import_id","shop_id");