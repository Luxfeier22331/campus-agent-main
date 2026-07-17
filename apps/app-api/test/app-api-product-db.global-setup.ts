import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { installCampusServicesSchema } from "../../../jobs/transport-publisher/src/schema.ts";
import { installAppApiSchema } from "../ops/db/schema.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent";
const SCHEMA_OWNER = "app_api_schema_owner";
const RUNTIME_ROLE = "app_api";
const SUPPORTING_ROLES = ["campus_services_publisher", "execution_control", "ops_web"] as const;
const transportFixturePath = fileURLToPath(
	new URL("../db/shared-product-schema/testdata/transport_integration.sql", import.meta.url),
);

export interface AppApiPostgresContext {
	managementConnectionString: string;
	runtimeConnectionString: string;
}

declare module "vitest" {
	export interface ProvidedContext {
		appApiPostgres: AppApiPostgresContext;
	}
}

function roleConnectionString(connectionString: string, role: string, password: string): string {
	const url = new URL(connectionString);
	url.username = role;
	url.password = password;
	url.searchParams.set("sslmode", "disable");
	return url.toString();
}

async function provisionDatabase(
	container: StartedPostgreSqlContainer,
): Promise<AppApiPostgresContext> {
	const adminConnectionString = container.getConnectionUri();
	const schemaOwnerPassword = randomBytes(24).toString("hex");
	const runtimePassword = randomBytes(24).toString("hex");
	const admin = new Client({ connectionString: adminConnectionString });
	await admin.connect();
	try {
		await admin.query(`create role "${SCHEMA_OWNER}" login password '${schemaOwnerPassword}'`);
		await admin.query(`create role "${RUNTIME_ROLE}" login password '${runtimePassword}'`);
		for (const role of SUPPORTING_ROLES) {
			await admin.query(`create role "${role}" nologin`);
		}
		await admin.query(`alter database "${DATABASE_NAME}" owner to "${SCHEMA_OWNER}"`);
	} finally {
		await admin.end();
	}

	const managementConnectionString = roleConnectionString(
		adminConnectionString,
		SCHEMA_OWNER,
		schemaOwnerPassword,
	);
	const runtimeConnectionString = roleConnectionString(
		adminConnectionString,
		RUNTIME_ROLE,
		runtimePassword,
	);

	await installCampusServicesSchema({
		connectionString: managementConnectionString,
		ssl: false,
	});
	await installAppApiSchema({
		APP_API_DATABASE_SSLMODE: "disable",
		APP_API_SCHEMA_DATABASE_URL: managementConnectionString,
		AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
		BETTER_AUTH_SECRET: "testcontainers-app-api-product-database-secret",
	});

	const owner = new Client({ connectionString: managementConnectionString, ssl: false });
	await owner.connect();
	try {
		await owner.query(await readFile(transportFixturePath, "utf8"));
	} finally {
		await owner.end();
	}

	return { managementConnectionString, runtimeConnectionString };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
	let container: StartedPostgreSqlContainer | undefined;
	try {
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withDatabase(DATABASE_NAME)
			.withUsername("postgres")
			.withPassword(randomUUID())
			.start();
		project.provide("appApiPostgres", await provisionDatabase(container));
	} catch (error) {
		await container?.stop();
		throw error;
	}

	return async () => {
		await container?.stop();
	};
}
