DO $internal_portal_handoff$
DECLARE
	actual_columns text;
	actual_constraints text;
	actual_indexes text;
	actual_relations text;
BEGIN
	IF to_regnamespace('internal_portal') IS NULL THEN
		RAISE EXCEPTION 'internal_portal schema is missing';
	END IF;
	IF to_regclass('ingestion_control.internal_portal_credentials') IS NULL THEN
		RAISE EXCEPTION 'ingestion_control.internal_portal_credentials is missing';
	END IF;
	IF to_regclass('internal_portal.credentials') IS NOT NULL THEN
		RAISE EXCEPTION 'internal_portal.credentials already exists; refusing an ambiguous credential handoff';
	END IF;
	SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
	INTO actual_columns
	FROM information_schema.columns
	WHERE table_schema = 'ingestion_control'
		AND table_name = 'internal_portal_credentials';
	IF actual_columns <> 'credential_id,name,sso_tgc,version,created_at,updated_at,last_attempt_at,last_successful_at,last_outcome' THEN
		RAISE EXCEPTION 'ingestion-control credential columns do not match the handoff contract: %', actual_columns;
	END IF;
	SELECT string_agg(class.relname, ',' ORDER BY class.relname)
	INTO actual_relations
	FROM pg_catalog.pg_class class
	JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
	WHERE namespace.nspname = 'ingestion_control'
		AND class.relkind IN ('r', 'p', 'v', 'm', 'f', 'S');
	IF actual_relations <> 'internal_portal_credentials,schema_migrations' THEN
		RAISE EXCEPTION 'ingestion_control contains unknown relations: %', actual_relations;
	END IF;
	SELECT string_agg(con.conname, ',' ORDER BY con.conname)
	INTO actual_constraints
	FROM pg_catalog.pg_constraint con
	JOIN pg_catalog.pg_class class ON class.oid = con.conrelid
	JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
	WHERE namespace.nspname = 'ingestion_control'
		AND class.relname = 'internal_portal_credentials'
		AND con.contype <> 'n';
	IF actual_constraints <> 'ingestion_control_internal_portal_credentials_name_check,ingestion_control_internal_portal_credentials_outcome_check,ingestion_control_internal_portal_credentials_sso_tgc_check,ingestion_control_internal_portal_credentials_version_check,internal_portal_credentials_pkey' THEN
		RAISE EXCEPTION 'ingestion-control credential constraints do not match the handoff contract: %', actual_constraints;
	END IF;
	SELECT string_agg(indexname, ',' ORDER BY indexname)
	INTO actual_indexes
	FROM pg_catalog.pg_indexes
	WHERE schemaname = 'ingestion_control'
		AND tablename = 'internal_portal_credentials';
	IF actual_indexes <> 'ingestion_control_internal_portal_credentials_name_uidx,internal_portal_credentials_pkey' THEN
		RAISE EXCEPTION 'ingestion-control credential indexes do not match the handoff contract: %', actual_indexes;
	END IF;
	IF (SELECT tableowner FROM pg_catalog.pg_tables
		WHERE schemaname = 'ingestion_control' AND tablename = 'internal_portal_credentials') <> current_user THEN
		RAISE EXCEPTION 'ingestion-control credentials must be owned by the schema migration role';
	END IF;
END
$internal_portal_handoff$;
--> statement-breakpoint
ALTER TABLE "ingestion_control"."internal_portal_credentials"
	SET SCHEMA "internal_portal";
--> statement-breakpoint
ALTER TABLE "internal_portal"."internal_portal_credentials"
	RENAME TO "credentials";
--> statement-breakpoint
ALTER INDEX "internal_portal"."ingestion_control_internal_portal_credentials_name_uidx"
	RENAME TO "internal_portal_credentials_name_uidx";
--> statement-breakpoint
ALTER TABLE "internal_portal"."credentials"
	RENAME CONSTRAINT "ingestion_control_internal_portal_credentials_name_check"
	TO "internal_portal_credentials_name_check";
--> statement-breakpoint
ALTER TABLE "internal_portal"."credentials"
	RENAME CONSTRAINT "ingestion_control_internal_portal_credentials_sso_tgc_check"
	TO "internal_portal_credentials_sso_tgc_check";
--> statement-breakpoint
ALTER TABLE "internal_portal"."credentials"
	RENAME CONSTRAINT "ingestion_control_internal_portal_credentials_version_check"
	TO "internal_portal_credentials_version_check";
--> statement-breakpoint
ALTER TABLE "internal_portal"."credentials"
	RENAME CONSTRAINT "ingestion_control_internal_portal_credentials_outcome_check"
	TO "internal_portal_credentials_outcome_check";
--> statement-breakpoint
ALTER TABLE "internal_portal"."credentials"
	RENAME CONSTRAINT "internal_portal_credentials_pkey"
	TO "credentials_pkey";
