import process from "node:process";

import pg, { type Client } from "pg";
import { type DatabaseSslConfig, readDatabaseConnectionConfig } from "./postgres-tls.ts";

const DINING_TABLES = [
	"map_draft",
	"map_publication",
	"map_releases",
	"menu_items",
	"review_edits",
	"review_reports",
	"reviews",
] as const;

const DINING_GRANT_STATEMENTS = [
	`REVOKE ALL PRIVILEGES ON SCHEMA "dining" FROM PUBLIC, "ops_web", "app_api"`,
	`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "dining" FROM PUBLIC, "ops_web", "app_api"`,
	`GRANT USAGE ON SCHEMA "dining" TO "ops_web", "app_api"`,
	`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
		"dining"."map_draft",
		"dining"."map_releases",
		"dining"."map_publication",
		"dining"."menu_items",
		"dining"."reviews",
		"dining"."review_reports",
		"dining"."review_edits"
	 TO "ops_web"`,
	`GRANT SELECT ON TABLE
		"dining"."map_releases",
		"dining"."map_publication",
		"dining"."menu_items"
	 TO "app_api"`,
	`GRANT SELECT, INSERT, UPDATE ON TABLE "dining"."reviews" TO "app_api"`,
	`GRANT SELECT, INSERT ON TABLE "dining"."review_reports" TO "app_api"`,
] as const;

const OPS_WEB_GRANT_STATEMENTS = [
	`GRANT USAGE ON SCHEMA "notices" TO "ops_web"`,
	`GRANT SELECT ON TABLE
		"notices"."notice_types",
		"notices"."organizations",
		"notices"."categories"
	 TO "ops_web"`,
	`GRANT SELECT (
		"notice_id", "notice_type", "organization_id", "title", "released_at",
		"is_external", "external_url", "category", "is_published"
	 ) ON TABLE "notices"."notices" TO "ops_web"`,
	`GRANT UPDATE ("category") ON TABLE "notices"."notices" TO "ops_web"`,
	`REVOKE ALL PRIVILEGES ON SCHEMA "internal_portal" FROM PUBLIC, "ops_web", "app_api"`,
	`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "internal_portal" FROM PUBLIC, "ops_web", "app_api"`,
	`GRANT USAGE ON SCHEMA "internal_portal" TO "ops_web"`,
	`GRANT SELECT, INSERT, UPDATE, DELETE
	 ON TABLE
		"internal_portal"."automation_tokens",
		"internal_portal"."credentials"
	 TO "ops_web"`,
	`GRANT USAGE ON SCHEMA "chat" TO "ops_web"`,
	`REVOKE ALL PRIVILEGES ON TABLE
		"chat"."turn_dispatches",
		"chat"."messages",
		"runtime"."request_observability_fact"
	FROM "ops_web"`,
	`DO $ops_web_read_model_column_revoke$
	DECLARE
		relation record;
		column_names text;
	BEGIN
		FOR relation IN
			SELECT class.oid AS relation_oid, namespace.nspname AS schema_name,
				class.relname AS relation_name
			FROM pg_catalog.pg_class class
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
			WHERE (namespace.nspname, class.relname) IN (
				('chat', 'turn_dispatches'),
				('chat', 'messages'),
				('runtime', 'request_observability_fact')
			)
		LOOP
			SELECT pg_catalog.string_agg(
				pg_catalog.quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum
			)
			INTO column_names
			FROM pg_catalog.pg_attribute attribute
			WHERE attribute.attrelid = relation.relation_oid
				AND attribute.attnum > 0
				AND NOT attribute.attisdropped;

			IF column_names IS NOT NULL THEN
				EXECUTE pg_catalog.format(
					'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM %I',
					column_names,
					relation.schema_name,
					relation.relation_name,
					'ops_web'
				);
			END IF;
		END LOOP;
	END
	$ops_web_read_model_column_revoke$`,
	`GRANT SELECT (
		"assistant_message_id", "completed_at", "conversation_id", "created_at", "error_code",
		"request_id", "status", "updated_at", "user_message_id"
	) ON TABLE "chat"."turn_dispatches" TO "ops_web"`,
	`GRANT SELECT (
		"conversation_id", "id", "kind", "request_id", "role", "structured_parts_json", "text"
	) ON TABLE "chat"."messages" TO "ops_web"`,
] as const;

export async function applyDiningGrantStatements(client: {
	query(sql: string): Promise<unknown>;
}): Promise<void> {
	for (const statement of DINING_GRANT_STATEMENTS) {
		await client.query(statement);
	}
}

export async function applyOpsWebGrantStatements(client: {
	query(sql: string): Promise<unknown>;
}): Promise<void> {
	await applyDiningGrantStatements(client);
	for (const statement of OPS_WEB_GRANT_STATEMENTS) {
		await client.query(statement);
	}
}

interface DatabaseConnectionConfig {
	connectionString: string;
	ssl: DatabaseSslConfig;
}
const REQUIRED_SELECTS = [
	{
		label: "notices.notices",
		sql: `
			select "notice_id", "notice_type", "organization_id", "title", "released_at",
				"is_external", "external_url", "category", "is_published"
			from "notices"."notices"
			limit 0
		`,
	},
	{
		label: "notices mappings",
		sql: `
			select "notice_type", "name" from "notices"."notice_types" limit 0;
			select "organization_id", "name" from "notices"."organizations" limit 0;
			select "category" from "notices"."categories" limit 0
		`,
	},
	{
		label: "internal_portal.automation_tokens",
		sql: `
			select "token_id", "name", "token_value", "token_hash", "created_at", "revoked_at"
			from "internal_portal"."automation_tokens"
			limit 0
		`,
	},
	{
		label: "internal_portal.credentials",
		sql: `
			select "credential_id", "name", "sso_tgc", "version", "created_at", "updated_at",
				"last_attempt_at", "last_successful_at", "last_outcome"
			from "internal_portal"."credentials"
			limit 0
		`,
	},
	{
		label: "dining.map_draft",
		sql: `
			select "scope", "bundle_json", "fingerprint", "revision", "updated_at", "updated_by"
			from "dining"."map_draft"
			limit 0
		`,
	},
	{
		label: "dining.map_releases",
		sql: `
			select "release_id", "snapshot_hash", "draft_revision", "kind",
				"restored_from_release_id", "bundle_json", "public_payload_json",
				"created_at", "created_by"
			from "dining"."map_releases"
			limit 0
		`,
	},
	{
		label: "dining.map_publication",
		sql: `
			select "scope", "release_id", "updated_at", "updated_by"
			from "dining"."map_publication"
			limit 0
		`,
	},
	{
		label: "dining.menu_items",
		sql: `
			select "menu_item_id", "window_id", "name", "price_text", "sort_order",
				"archived_at", "created_at", "created_by", "updated_at", "updated_by"
			from "dining"."menu_items"
			limit 0
		`,
	},
	{
		label: "dining.reviews",
		sql: `
			select "review_id", "menu_item_id", "author_kind", "author_id",
				"author_display_name", "anonymous", "body", "idempotency_key",
				"submission_date", "created_at", "updated_at", "updated_by",
				"edited_at", "hidden_at", "hidden_by", "deleted_at", "deleted_by"
			from "dining"."reviews"
			limit 0
		`,
	},
	{
		label: "dining.review_reports",
		sql: `
			select "report_id", "review_id", "reporter_user_id", "reason", "details",
				"created_at", "resolution", "resolved_at", "resolved_by"
			from "dining"."review_reports"
			limit 0
		`,
	},
	{
		label: "dining.review_edits",
		sql: `
			select "edit_id", "review_id", "previous_body", "next_body", "edited_at", "edited_by"
			from "dining"."review_edits"
			limit 0
		`,
	},
	{
		label: "chat.turn_dispatches",
		sql: `
			select
				"assistant_message_id",
				"completed_at",
				"conversation_id",
				"created_at",
				"error_code",
				"request_id",
				"status",
				"updated_at",
				"user_message_id"
			from "chat"."turn_dispatches"
			limit 0
		`,
	},
	{
		label: "chat.messages",
		sql: `
			select
					"conversation_id",
					"id",
					"kind",
					"request_id",
					"role",
					"structured_parts_json",
					"text"
			from "chat"."messages"
			limit 0
		`,
	},
	{
		label: "execution_control.agent_runs",
		sql: `
			select
				"completed_at",
				"fail_close_reason",
				"request_id",
				"status",
				"terminal_reason",
				"updated_at"
			from "execution_control"."agent_runs"
			limit 0
		`,
	},
	{
		label: "execution_control.agent_run_steps",
		sql: `
			select
				"step_id", "request_id", "step_kind", "status", "started_at",
				"completed_at", "updated_at", "sanitized_payload_json"
			from "execution_control"."agent_run_steps"
			limit 0
		`,
	},
	{
		label: "execution_control.agent_step_attempts",
		sql: `
			select
				"step_id", "request_id", "attempt", "status", "started_at", "completed_at",
				"duration_ms", "model_provider", "model_name", "model_request_count",
				"input_tokens", "output_tokens", "cached_input_tokens", "usage_observed",
				"fail_close_reason", "terminal_reason", "sanitized_payload_json"
			from "execution_control"."agent_step_attempts"
			limit 0
		`,
	},
];

function createClient(config: DatabaseConnectionConfig): Client {
	return new pg.Client({
		connectionString: config.connectionString,
		ssl: config.ssl,
	});
}

async function withClient<T>(
	config: DatabaseConnectionConfig,
	fn: (client: Client) => Promise<T>,
): Promise<T> {
	const client = createClient(config);
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end();
	}
}

async function assertDatabaseRole(client: Client, roleName: string): Promise<void> {
	const roleResult = await client.query("select 1 as present from pg_roles where rolname = $1", [
		roleName,
	]);
	if (roleResult.rowCount !== 1) {
		throw new Error(
			`${roleName} role is missing; create the role before applying database grants.`,
		);
	}
}

async function verifyDatabaseRoles(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		await assertDatabaseRole(client, "ops_web");
		await assertDatabaseRole(client, "app_api");
	});
}

async function verifyDiningSchemaAndAppApiGrants(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		const tables = await client.query<{ table_name: string }>(`
			select table_name
			from information_schema.tables
			where table_schema = 'dining' and table_type = 'BASE TABLE'
			order by table_name
		`);
		const actualTables = tables.rows.map((row) => row.table_name);
		const expectedTables = [...DINING_TABLES].sort();
		if (actualTables.join(",") !== expectedTables.join(",")) {
			throw new Error(
				`dining schema must contain only ${expectedTables.join(", ")}; found ${actualTables.join(", ") || "none"}.`,
			);
		}

		const privileges = await client.query<{
			canDeleteReports: boolean;
			canDeleteReviews: boolean;
			canInsertReports: boolean;
			canInsertReviews: boolean;
			canMutateDraft: boolean;
			canMutateEdits: boolean;
			canMutateMenu: boolean;
			canMutatePublication: boolean;
			canMutateReleases: boolean;
			canReadDraft: boolean;
			canReadEdits: boolean;
			canReadMenu: boolean;
			canReadPublication: boolean;
			canReadReports: boolean;
			canReadReleases: boolean;
			canReadReviews: boolean;
			canUpdateReports: boolean;
			canUpdateReviews: boolean;
			canUseSchema: boolean;
		}>(`select
			has_schema_privilege('app_api', 'dining', 'USAGE') as "canUseSchema",
			has_table_privilege('app_api', 'dining.map_draft', 'SELECT') as "canReadDraft",
			has_table_privilege('app_api', 'dining.map_releases', 'SELECT') as "canReadReleases",
			has_table_privilege('app_api', 'dining.map_publication', 'SELECT') as "canReadPublication",
			has_table_privilege('app_api', 'dining.menu_items', 'SELECT') as "canReadMenu",
			has_table_privilege('app_api', 'dining.reviews', 'SELECT') as "canReadReviews",
			has_table_privilege('app_api', 'dining.review_reports', 'SELECT') as "canReadReports",
			has_table_privilege('app_api', 'dining.review_edits', 'SELECT') as "canReadEdits",
			has_table_privilege('app_api', 'dining.map_draft', 'INSERT,UPDATE,DELETE') as "canMutateDraft",
			has_table_privilege('app_api', 'dining.map_releases', 'INSERT,UPDATE,DELETE') as "canMutateReleases",
			has_table_privilege('app_api', 'dining.map_publication', 'INSERT,UPDATE,DELETE') as "canMutatePublication",
			has_table_privilege('app_api', 'dining.menu_items', 'INSERT,UPDATE,DELETE') as "canMutateMenu",
			has_table_privilege('app_api', 'dining.reviews', 'INSERT') as "canInsertReviews",
			has_table_privilege('app_api', 'dining.reviews', 'UPDATE') as "canUpdateReviews",
			has_table_privilege('app_api', 'dining.reviews', 'DELETE') as "canDeleteReviews",
			has_table_privilege('app_api', 'dining.review_reports', 'INSERT') as "canInsertReports",
			has_table_privilege('app_api', 'dining.review_reports', 'UPDATE') as "canUpdateReports",
			has_table_privilege('app_api', 'dining.review_reports', 'DELETE') as "canDeleteReports",
			has_table_privilege('app_api', 'dining.review_edits', 'INSERT,UPDATE,DELETE') as "canMutateEdits"`);
		const access = privileges.rows[0];
		if (
			!(
				access?.canUseSchema &&
				access.canReadReleases &&
				access.canReadPublication &&
				access.canReadMenu &&
				access.canReadReviews &&
				access.canReadReports &&
				access.canInsertReviews &&
				access.canUpdateReviews &&
				access.canInsertReports
			) ||
			access.canReadDraft ||
			access.canReadEdits ||
			access.canMutateDraft ||
			access.canMutateEdits ||
			access.canMutateMenu ||
			access.canMutateReleases ||
			access.canMutatePublication ||
			access.canDeleteReviews ||
			access.canUpdateReports ||
			access.canDeleteReports
		) {
			throw new Error(
				"app_api Dining privileges do not match the public menu and member review boundary.",
			);
		}
	});
}

async function verifyOpsWebRoleAndGrants(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		await assertOpsWebCurrentUser(client);

		for (const check of REQUIRED_SELECTS) {
			try {
				await client.query(check.sql);
			} catch (error) {
				throw new Error(
					`ops_web cannot read ${check.label}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		await verifyOpsWebDiningPrivileges(client);
		await verifyOpsWebInternalPortalPrivileges(client);

		const providerConfigPrivileges = await client.query<{
			canAccessCompatibilityView: boolean;
			canAccessModelSettings: boolean;
		}>(`select
			exists (
				select 1
				from pg_catalog.pg_class class
				join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
				where namespace.nspname = 'execution_control' and class.relname = 'model_settings'
					and (
						has_table_privilege(
							current_user, class.oid,
							'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
						)
						or has_any_column_privilege(
							current_user, class.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
						)
					)
			) as "canAccessModelSettings",
			exists (
				select 1
				from pg_catalog.pg_class class
				join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
				where namespace.nspname = 'execution_config' and class.relname = 'model_settings'
					and (
						has_table_privilege(
							current_user, class.oid,
							'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
						)
						or has_any_column_privilege(
							current_user, class.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
						)
					)
			) as "canAccessCompatibilityView"`);
		const providerConfigAccess = providerConfigPrivileges.rows[0];
		if (
			providerConfigAccess?.canAccessModelSettings !== false ||
			providerConfigAccess.canAccessCompatibilityView !== false
		) {
			throw new Error("ops_web must not have direct access to execution model settings.");
		}
	});
}

async function verifyOpsWebInternalPortalPrivileges(client: Client): Promise<void> {
	const privileges = await client.query<{
		canAccessCredentials: boolean;
		canTokensDelete: boolean;
		canTokensInsert: boolean;
		canTokensSelect: boolean;
		canTokensUpdate: boolean;
		canUseSchema: boolean;
	}>(`select
		has_schema_privilege(current_user, 'internal_portal', 'USAGE') as "canUseSchema",
		exists (
			select 1
			from pg_catalog.pg_class class
			join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
			where namespace.nspname = 'internal_portal'
				and class.relname = 'credentials'
				and class.relkind in ('r', 'p', 'v', 'm', 'f')
				and (
					has_table_privilege(current_user, class.oid, 'SELECT')
					or has_table_privilege(current_user, class.oid, 'INSERT')
					or has_table_privilege(current_user, class.oid, 'UPDATE')
					or has_table_privilege(current_user, class.oid, 'DELETE')
					or has_any_column_privilege(current_user, class.oid, 'SELECT')
					or has_any_column_privilege(current_user, class.oid, 'INSERT')
					or has_any_column_privilege(current_user, class.oid, 'UPDATE')
				)
		) as "canAccessCredentials",
		has_table_privilege(current_user, 'internal_portal.automation_tokens', 'SELECT') as "canTokensSelect",
		has_table_privilege(current_user, 'internal_portal.automation_tokens', 'INSERT') as "canTokensInsert",
		has_table_privilege(current_user, 'internal_portal.automation_tokens', 'UPDATE') as "canTokensUpdate",
		has_table_privilege(current_user, 'internal_portal.automation_tokens', 'DELETE') as "canTokensDelete"`);
	const access = privileges.rows[0];
	if (
		!(
			access?.canUseSchema &&
			access.canTokensSelect &&
			access.canTokensInsert &&
			access.canTokensUpdate &&
			access.canTokensDelete &&
			access.canAccessCredentials
		)
	) {
		throw new Error("ops_web internal portal privileges do not match automation-token ownership.");
	}
}

async function verifyInternalPortalSchemaBoundary(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		const tokenColumns = await client.query<{ column_name: string }>(`
			select column_name
			from information_schema.columns
			where table_schema = 'internal_portal' and table_name = 'automation_tokens'
			order by ordinal_position
		`);
		const expectedTokens = [
			"token_id",
			"name",
			"token_value",
			"token_hash",
			"created_at",
			"revoked_at",
		];
		if (tokenColumns.rows.map((row) => row.column_name).join(",") !== expectedTokens.join(",")) {
			throw new Error("internal_portal.automation_tokens does not match the owned schema.");
		}
		const credentialHandoff = await client.query<{
			currentTable: string | null;
			legacySchema: string | null;
		}>(`select
			to_regclass('internal_portal.credentials')::text as "currentTable",
			to_regnamespace('ingestion_control')::text as "legacySchema"`);
		if (
			credentialHandoff.rows[0]?.currentTable !== "internal_portal.credentials" ||
			credentialHandoff.rows[0]?.legacySchema !== null
		) {
			throw new Error(
				"internal portal credential ownership handoff or legacy schema cleanup is incomplete.",
			);
		}
		const privileges = await client.query<{
			appApiCanAccess: boolean;
		}>(`select
			has_schema_privilege('app_api', 'internal_portal', 'USAGE')
				or has_table_privilege('app_api', 'internal_portal.automation_tokens', 'SELECT,INSERT,UPDATE,DELETE')
				or has_table_privilege('app_api', 'internal_portal.credentials', 'SELECT,INSERT,UPDATE,DELETE')
				as "appApiCanAccess"`);
		if (privileges.rows[0]?.appApiCanAccess) {
			throw new Error("app_api must not access internal portal operational data.");
		}
	});
}

async function assertOpsWebCurrentUser(client: Client): Promise<void> {
	const currentUserResult = await client.query(`select current_user as "currentUser"`);
	const currentUser = currentUserResult.rows[0]?.currentUser;
	if (currentUser !== "ops_web") {
		throw new Error(
			`OPS_WEB_DATABASE_URL must connect as ops_web; current_user is ${currentUser ?? "<unknown>"}.`,
		);
	}
}

async function verifyOpsWebDiningPrivileges(client: Client): Promise<void> {
	const diningPrivileges = await client.query<{
		canMutateEdits: boolean;
		canMutateMenu: boolean;
		canMutateReports: boolean;
		canMutateReviews: boolean;
		canMutateDraft: boolean;
		canMutatePublication: boolean;
		canMutateReleases: boolean;
		canUseSchema: boolean;
	}>(`select
		has_schema_privilege(current_user, 'dining', 'USAGE') as "canUseSchema",
		has_table_privilege(current_user, 'dining.map_draft', 'INSERT,UPDATE,DELETE') as "canMutateDraft",
		has_table_privilege(current_user, 'dining.map_releases', 'INSERT,UPDATE,DELETE') as "canMutateReleases",
		has_table_privilege(current_user, 'dining.map_publication', 'INSERT,UPDATE,DELETE') as "canMutatePublication",
		has_table_privilege(current_user, 'dining.menu_items', 'INSERT,UPDATE,DELETE') as "canMutateMenu",
		has_table_privilege(current_user, 'dining.reviews', 'INSERT,UPDATE,DELETE') as "canMutateReviews",
		has_table_privilege(current_user, 'dining.review_reports', 'INSERT,UPDATE,DELETE') as "canMutateReports",
		has_table_privilege(current_user, 'dining.review_edits', 'INSERT,UPDATE,DELETE') as "canMutateEdits"`);
	const diningAccess = diningPrivileges.rows[0];
	if (
		!(
			diningAccess?.canUseSchema &&
			diningAccess.canMutateDraft &&
			diningAccess.canMutateReleases &&
			diningAccess.canMutatePublication &&
			diningAccess.canMutateMenu &&
			diningAccess.canMutateReviews &&
			diningAccess.canMutateReports &&
			diningAccess.canMutateEdits
		)
	) {
		throw new Error("ops_web is missing required Dining map write privileges.");
	}
}

async function verifyOpsWebDiningAccess(config: DatabaseConnectionConfig): Promise<void> {
	return withClient(config, async (client) => {
		await assertOpsWebCurrentUser(client);
		await verifyOpsWebDiningPrivileges(client);
	});
}

function readDatabaseConfigs(env: NodeJS.ProcessEnv): {
	schemaAdmin: DatabaseConnectionConfig;
	opsWeb: DatabaseConnectionConfig;
} {
	return {
		schemaAdmin: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_WEB_SCHEMA_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_WEB_SCHEMA_DATABASE_URL",
			sslMode: "OPS_WEB_SCHEMA_DATABASE_SSLMODE",
		}),
		opsWeb: readDatabaseConnectionConfig(env, {
			caCertPath: "OPS_WEB_DATABASE_CA_CERT_PATH",
			databaseUrl: "OPS_WEB_DATABASE_URL",
			sslMode: "OPS_WEB_DATABASE_SSLMODE",
		}),
	};
}

export async function applyOpsWebDatabaseGrants(env: NodeJS.ProcessEnv = process.env): Promise<{
	diningMap: "ready";
	internalPortal: "ready";
	opsWebRole: "ready";
	readModel: "ready";
}> {
	const config = readDatabaseConfigs(env);
	await withClient(config.schemaAdmin, async (client) => {
		await assertDatabaseRole(client, "ops_web");
		await assertDatabaseRole(client, "app_api");
		await client.query("begin");
		try {
			await applyOpsWebGrantStatements(client);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	});
	await verifyDiningSchemaAndAppApiGrants(config.schemaAdmin);
	await verifyInternalPortalSchemaBoundary(config.schemaAdmin);
	await verifyOpsWebRoleAndGrants(config.opsWeb);
	return {
		diningMap: "ready",
		internalPortal: "ready",
		opsWebRole: "ready",
		readModel: "ready",
	};
}

export async function applyOpsWebDiningGrants(env: NodeJS.ProcessEnv = process.env): Promise<{
	diningMap: "ready";
}> {
	const config = readDatabaseConfigs(env);
	await withClient(config.schemaAdmin, async (client) => {
		await assertDatabaseRole(client, "ops_web");
		await assertDatabaseRole(client, "app_api");
		await client.query("begin");
		try {
			await applyDiningGrantStatements(client);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	});
	await verifyDiningSchemaAndAppApiGrants(config.schemaAdmin);
	await verifyOpsWebDiningAccess(config.opsWeb);
	return { diningMap: "ready" };
}

export async function verifyOpsWebDatabase(env: NodeJS.ProcessEnv = process.env): Promise<{
	diningMap: "ready";
	internalPortal: "ready";
	opsWebRole: "ready";
	readModel: "ready";
}> {
	const config = readDatabaseConfigs(env);

	await verifyDatabaseRoles(config.schemaAdmin);
	await verifyDiningSchemaAndAppApiGrants(config.schemaAdmin);
	await verifyInternalPortalSchemaBoundary(config.schemaAdmin);
	await verifyOpsWebRoleAndGrants(config.opsWeb);

	return {
		diningMap: "ready",
		internalPortal: "ready",
		opsWebRole: "ready",
		readModel: "ready",
	};
}
