import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client, type ClientConfig } from "pg";
import type { TransportPublisherDatabaseClientFactory } from "./postgres-publisher";

const CAMPUS_SERVICES_GRANTS_SQL = `
REVOKE ALL ON SCHEMA "campus_services" FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA "campus_services" FROM PUBLIC;
REVOKE ALL ON SCHEMA "campus_services"
FROM "campus_services_publisher", "app_api", "execution_control", "ops_web";
REVOKE ALL ON ALL TABLES IN SCHEMA "campus_services"
FROM "campus_services_publisher", "app_api", "execution_control", "ops_web";

GRANT USAGE ON SCHEMA "campus_services"
TO "campus_services_publisher", "app_api", "execution_control";

GRANT SELECT, INSERT ON
  "campus_services"."transport_releases",
  "campus_services"."transport_routes",
  "campus_services"."transport_departures",
  "campus_services"."transport_current"
TO "campus_services_publisher";
GRANT UPDATE ("release_id") ON "campus_services"."transport_releases"
TO "campus_services_publisher";
GRANT UPDATE ("release_id", "updated_at") ON "campus_services"."transport_current"
TO "campus_services_publisher";

GRANT SELECT ON
  "campus_services"."transport_releases",
  "campus_services"."transport_current"
TO "app_api";

GRANT SELECT ON ALL TABLES IN SCHEMA "campus_services"
TO "execution_control";
`;

export function defaultCampusServicesSchemaPath(): string {
	return fileURLToPath(
		new URL(
			"../../../apps/app-api/db/shared-product-schema/campus_services.sql",
			import.meta.url,
		),
	);
}

export async function installCampusServicesSchema(
	databaseConfig: ClientConfig,
	options: {
		createClient?: TransportPublisherDatabaseClientFactory;
		schemaPath?: string;
	} = {},
): Promise<void> {
	const client = options.createClient?.() ?? new Client(databaseConfig);
	const schemaSql = await readFile(options.schemaPath ?? defaultCampusServicesSchemaPath(), "utf8");
	await client.connect();
	try {
		await client.query("BEGIN");
		await client.query(schemaSql);
		await client.query(CAMPUS_SERVICES_GRANTS_SQL);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		await client.end();
	}
}
