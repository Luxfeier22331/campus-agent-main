DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "app_auth"."account"
    GROUP BY "providerId", "accountId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate app_auth.account: duplicate (providerId, accountId) identities exist';
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_uidx"
ON "app_auth"."account" USING btree ("providerId", "accountId");--> statement-breakpoint
DROP INDEX "app_auth"."account_issuer_accountId_uidx";--> statement-breakpoint
ALTER TABLE "app_auth"."account" ALTER COLUMN "issuer" DROP NOT NULL;
