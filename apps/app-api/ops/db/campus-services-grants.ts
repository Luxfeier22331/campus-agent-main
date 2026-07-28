import type { DatabaseGrantClient } from "./app-api-grants.ts";

const APP_API_TRANSPORT_TABLES = ["transport_releases", "transport_current"] as const;
const EXECUTION_CONTROL_TRANSPORT_TABLES = [
	"transport_releases",
	"transport_routes",
	"transport_departures",
	"transport_current",
] as const;

function qualifiedTables(tables: readonly string[]): string {
	return tables.map((table) => `"campus_services"."${table}"`).join(",\n  ");
}

export function buildCampusServicesGrantSql(): string {
	return [
		`REVOKE ALL ON SCHEMA "campus_services" FROM PUBLIC`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "campus_services" FROM PUBLIC`,
		`REVOKE ALL ON SCHEMA "campus_services" FROM "app_api", "execution_control"`,
		`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "campus_services" FROM "app_api", "execution_control"`,
		`DO $retire_campus_services_ops_web$\nBEGIN\n\tIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_web') THEN\n\t\tREVOKE ALL ON SCHEMA "campus_services" FROM "ops_web";\n\t\tREVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "campus_services" FROM "ops_web";\n\tEND IF;\nEND\n$retire_campus_services_ops_web$`,
		`GRANT USAGE ON SCHEMA "campus_services" TO "app_api", "execution_control"`,
		`GRANT SELECT ON\n  ${qualifiedTables(APP_API_TRANSPORT_TABLES)}\nTO "app_api"`,
		`GRANT SELECT ON\n  ${qualifiedTables(EXECUTION_CONTROL_TRANSPORT_TABLES)}\nTO "execution_control"`,
	].join(";\n");
}

export async function applyCampusServicesGrants(client: DatabaseGrantClient): Promise<void> {
	await client.query(buildCampusServicesGrantSql());
}
