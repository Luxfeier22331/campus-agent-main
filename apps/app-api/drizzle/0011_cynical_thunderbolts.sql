ALTER TABLE "app_auth"."rateLimit" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "app_auth"."rateLimit" SET "id" = "key" WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "app_auth"."rateLimit" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_auth"."rateLimit" DROP CONSTRAINT "rateLimit_pkey";--> statement-breakpoint
ALTER TABLE "app_auth"."rateLimit" ADD CONSTRAINT "rateLimit_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "app_auth"."rateLimit" ADD CONSTRAINT "rateLimit_key_unique" UNIQUE("key");
