DROP INDEX "app_auth"."account_issuer_accountId_uidx";--> statement-breakpoint
ALTER TABLE "app_auth"."account" ALTER COLUMN "issuer" DROP NOT NULL;
