CREATE SCHEMA IF NOT EXISTS "ingestion_control";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "ingestion_control" FROM PUBLIC, "ops_web", "app_api";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "ingestion_control" TO "ingestion_control";
--> statement-breakpoint
CREATE TABLE "ingestion_control"."internal_portal_credentials" (
	"credential_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sso_tgc" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_successful_at" timestamp with time zone,
	"last_outcome" text,
	CONSTRAINT "ingestion_control_internal_portal_credentials_name_check" CHECK (length(btrim("name")) between 1 and 80),
	CONSTRAINT "ingestion_control_internal_portal_credentials_sso_tgc_check" CHECK (length("sso_tgc") > 0),
	CONSTRAINT "ingestion_control_internal_portal_credentials_version_check" CHECK ("version" > 0),
	CONSTRAINT "ingestion_control_internal_portal_credentials_outcome_check" CHECK ("last_outcome" is null or "last_outcome" in ('valid', 'credential_rejected', 'check_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_control_internal_portal_credentials_name_uidx"
	ON "ingestion_control"."internal_portal_credentials" USING btree ("name");
--> statement-breakpoint
INSERT INTO "ingestion_control"."internal_portal_credentials" (
	credential_id, name, sso_tgc, version, created_at, updated_at,
	last_attempt_at, last_successful_at, last_outcome
)
SELECT
	credential_id, name, sso_tgc, version, created_at, updated_at,
	last_attempt_at, last_successful_at, last_outcome
FROM "internal_portal"."credentials";
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		(
			SELECT credential_id, name, sso_tgc, version, created_at, updated_at,
				last_attempt_at, last_successful_at, last_outcome
			FROM "internal_portal"."credentials"
			EXCEPT
			SELECT credential_id, name, sso_tgc, version, created_at, updated_at,
				last_attempt_at, last_successful_at, last_outcome
			FROM "ingestion_control"."internal_portal_credentials"
		)
		UNION ALL
		(
			SELECT credential_id, name, sso_tgc, version, created_at, updated_at,
				last_attempt_at, last_successful_at, last_outcome
			FROM "ingestion_control"."internal_portal_credentials"
			EXCEPT
			SELECT credential_id, name, sso_tgc, version, created_at, updated_at,
				last_attempt_at, last_successful_at, last_outcome
			FROM "internal_portal"."credentials"
		)
	) THEN
		RAISE EXCEPTION 'internal portal credential handoff verification failed';
	END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON TABLE "ingestion_control"."internal_portal_credentials" FROM PUBLIC, "ops_web", "app_api";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
	ON TABLE "ingestion_control"."internal_portal_credentials"
	TO "ingestion_control";
--> statement-breakpoint
DROP TABLE "internal_portal"."credentials";
