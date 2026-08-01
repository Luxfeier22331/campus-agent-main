CREATE SCHEMA "internal_portal";
--> statement-breakpoint
CREATE TABLE "internal_portal"."credentials" (
	"credential_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sso_tgc" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_successful_at" timestamp with time zone,
	"last_outcome" text,
	CONSTRAINT "internal_portal_credentials_name_check" CHECK (length(btrim("internal_portal"."credentials"."name")) between 1 and 80),
	CONSTRAINT "internal_portal_credentials_sso_tgc_check" CHECK (length("internal_portal"."credentials"."sso_tgc") > 0),
	CONSTRAINT "internal_portal_credentials_version_check" CHECK ("internal_portal"."credentials"."version" > 0),
	CONSTRAINT "internal_portal_credentials_outcome_check" CHECK ("internal_portal"."credentials"."last_outcome" is null or "internal_portal"."credentials"."last_outcome" in ('valid', 'credential_rejected', 'check_failed'))
);
