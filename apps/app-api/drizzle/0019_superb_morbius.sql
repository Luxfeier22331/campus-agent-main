ALTER TABLE "app_auth"."account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "app_auth"."account"
SET "issuer" = 'local:credential'
WHERE "providerId" = 'credential' AND "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "app_auth"."account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_auth"."jwks" ADD COLUMN "alg" text;--> statement-breakpoint
ALTER TABLE "app_auth"."jwks" ADD COLUMN "crv" text;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "app_auth"."account" USING btree ("issuer","accountId");
