const APP_API_DML_SCHEMAS = [
	"app_auth",
	"campus_services_ops",
	"chat",
	"identity",
	"observability",
	"profile",
] as const;

export interface DatabaseGrantClient {
	query(sql: string): Promise<unknown>;
}

export function buildAppApiGrantSql(): string {
	const schemaList = APP_API_DML_SCHEMAS.map((schema) => `"${schema}"`).join(", ");
	const perSchemaStatements = APP_API_DML_SCHEMAS.flatMap((schema) => [
		`REVOKE CREATE ON SCHEMA "${schema}" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "app_api"`,
	]);

	return [
		`DO $app_api_roles$\nBEGIN\n\tIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN\n\t\tRAISE EXCEPTION 'app_api database role is missing';\n\tEND IF;\n\tIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'docs_publish') THEN\n\t\tRAISE EXCEPTION 'docs_publish database role is missing';\n\tEND IF;\n\tIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_web_provider_config') THEN\n\t\tRAISE EXCEPTION 'ops_web_provider_config database role is missing';\n\tEND IF;\nEND\n$app_api_roles$`,
		`GRANT CONNECT ON DATABASE "campus_agent" TO "app_api"`,
		`GRANT CONNECT ON DATABASE "campus_agent" TO "docs_publish"`,
		`GRANT CONNECT ON DATABASE "campus_agent" TO "ops_web_provider_config"`,
		`GRANT USAGE ON SCHEMA ${schemaList}, "docs", "runtime" TO "app_api"`,
		...perSchemaStatements,
		`REVOKE CREATE ON SCHEMA "docs" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "docs" FROM "app_api"`,
		`GRANT SELECT ON ALL TABLES IN SCHEMA "docs" TO "app_api"`,
		`REVOKE CREATE ON SCHEMA "docs" FROM "docs_publish"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "docs" FROM "docs_publish"`,
		`GRANT USAGE ON SCHEMA "docs" TO "docs_publish"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "docs" TO "docs_publish"`,
		`REVOKE ALL PRIVILEGES ON SCHEMA "provider_config" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "provider_config" FROM "app_api"`,
		`REVOKE CREATE ON SCHEMA "provider_config" FROM "ops_web_provider_config"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "provider_config" FROM "ops_web_provider_config"`,
		`GRANT USAGE ON SCHEMA "provider_config" TO "ops_web_provider_config"`,
		`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "provider_config" TO "ops_web_provider_config"`,
		`REVOKE CREATE ON SCHEMA "runtime" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "runtime" FROM "app_api"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "runtime"."request_observability_fact" TO "app_api"`,
	].join(";\n");
}

export async function applyAppApiGrants(client: DatabaseGrantClient): Promise<void> {
	await client.query(buildAppApiGrantSql());
}
