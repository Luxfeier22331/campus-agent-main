const APP_API_DML_SCHEMAS = ["app_auth", "chat", "profile"] as const;

const APP_API_READ_SCHEMAS = ["campus_services", "docs"] as const;

export interface DatabaseGrantClient {
	query(sql: string): Promise<unknown>;
}

export function buildAppApiGrantSql(databaseName: string): string {
	const databaseIdentifier = quoteDatabaseIdentifier(databaseName);
	const schemaList = APP_API_DML_SCHEMAS.map((schema) => `"${schema}"`).join(", ");
	const perSchemaStatements = APP_API_DML_SCHEMAS.flatMap((schema) => [
		`REVOKE CREATE ON SCHEMA "${schema}" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "app_api"`,
	]);
	const readOnlyStatements = APP_API_READ_SCHEMAS.flatMap((schema) => [
		`GRANT USAGE ON SCHEMA "${schema}" TO "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "app_api"`,
	]);

	return [
		`DO $app_api_roles$\nBEGIN\n\tIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN\n\t\tRAISE EXCEPTION 'app_api database role is missing';\n\tEND IF;\n\tIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'docs_publish') THEN\n\t\tRAISE EXCEPTION 'docs_publish database role is missing';\n\tEND IF;\nEND\n$app_api_roles$`,
		`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO "app_api"`,
		`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO "docs_publish"`,
		`GRANT USAGE ON SCHEMA ${schemaList}, "runtime" TO "app_api"`,
		...perSchemaStatements,
		...readOnlyStatements,
		`REVOKE CREATE ON SCHEMA "docs" FROM "docs_publish"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "docs" FROM "docs_publish"`,
		`GRANT USAGE ON SCHEMA "docs" TO "docs_publish"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "docs" TO "docs_publish"`,
		`REVOKE CREATE ON SCHEMA "runtime" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "runtime" FROM "app_api"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "runtime"."request_observability_fact" TO "app_api"`,
	].join(";\n");
}

export async function applyAppApiGrants(
	client: DatabaseGrantClient,
	databaseName: string,
): Promise<void> {
	await client.query(buildAppApiGrantSql(databaseName));
}

function quoteDatabaseIdentifier(databaseName: string): string {
	if (!/^[a-z_][a-z0-9_]*$/u.test(databaseName)) {
		throw new Error("app-api database name must be a lowercase PostgreSQL identifier.");
	}
	return `"${databaseName}"`;
}
