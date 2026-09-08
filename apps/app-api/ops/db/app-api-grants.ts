const APP_API_DML_SCHEMAS = ["app_auth", "campus_groups", "chat", "profile"] as const;

const TRANSPORT_READ_TABLES = ["routes", "schedule_periods", "schedule_items"] as const;

export interface DatabaseGrantClient {
	query(sql: string): Promise<unknown>;
}

export function buildAppApiGrantSql(databaseName: string): string {
	const databaseIdentifier = quoteDatabaseIdentifier(databaseName);
	const schemaList = APP_API_DML_SCHEMAS.map((schema) => `"${schema}"`).join(", ");
	const transportReadGrants = TRANSPORT_READ_TABLES.map(
		(table) => `		EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE "transport"."${table}" FROM "app_api"';
		EXECUTE 'GRANT SELECT ON TABLE "transport"."${table}" TO "app_api"';`,
	).join("\n");
	const perSchemaStatements = APP_API_DML_SCHEMAS.flatMap((schema) => [
		`REVOKE CREATE ON SCHEMA "${schema}" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" FROM "app_api"`,
		`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "app_api"`,
	]);
	return [
		`DO $app_api_roles$\nBEGIN\n\tIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN\n\t\tRAISE EXCEPTION 'app_api database role is missing';\n\tEND IF;\nEND\n$app_api_roles$`,
		`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO "app_api"`,
		`GRANT USAGE ON SCHEMA ${schemaList}, "runtime" TO "app_api"`,
		...perSchemaStatements,
		`REVOKE CREATE ON SCHEMA "runtime" FROM "app_api"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "runtime" FROM "app_api"`,
		`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "runtime"."request_observability_fact" TO "app_api"`,
		`DO $app_api_transport_grants$
BEGIN
	IF to_regnamespace('transport') IS NOT NULL THEN
		EXECUTE 'REVOKE ALL PRIVILEGES ON SCHEMA "transport" FROM "app_api"';
		EXECUTE 'GRANT USAGE ON SCHEMA "transport" TO "app_api"';
${transportReadGrants}
	END IF;
END
$app_api_transport_grants$`,
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
