UPDATE "provider_config"."profiles"
SET "status" = CASE
	WHEN "validation_json"->>'ok' = 'true' THEN 'validated'
	ELSE 'validation_failed'
END
WHERE "status" = 'active';
--> statement-breakpoint
ALTER TABLE "provider_config"."profiles" DROP COLUMN "active";
--> statement-breakpoint
DO $provider_config_handoff$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
		EXECUTE 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "provider_config" FROM "app_api"';
	END IF;
END
$provider_config_handoff$;
