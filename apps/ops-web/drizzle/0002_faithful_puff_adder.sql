CREATE TABLE "internal_portal"."automation_tokens" (
	"token_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_value" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "internal_portal_automation_tokens_name_check" CHECK (length(btrim("internal_portal"."automation_tokens"."name")) between 1 and 80),
	CONSTRAINT "internal_portal_automation_tokens_value_check" CHECK (length("internal_portal"."automation_tokens"."token_value") > 0),
	CONSTRAINT "internal_portal_automation_tokens_hash_check" CHECK ("internal_portal"."automation_tokens"."token_hash" ~ '^[0-9a-f]{64}$')
);
