import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { migrateDining } from "../../../jobs/dining-sync/src/migrate.ts";
import { installCampusServicesSchema } from "../../../jobs/transport-publisher/src/schema.ts";
import { installAppApiSchema } from "../../app-api/ops/db/schema.ts";

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent";
const SCHEMA_OWNER = "ops_web_schema_owner";
const OPS_WEB_ROLE = "ops_web";
const OPS_WEB_DINING_ROLE = "ops_web_dining";
const NOLOGIN_ROLES = [
	"app_api",
	"campus_services_publisher",
	"docs_publish",
	"execution_control",
	"execution_provider_config_reader",
	"execution_provider_config_admin",
] as const;
const executionControlRoot = fileURLToPath(new URL("../../execution-control", import.meta.url));

export interface OpsWebPostgresContext {
	managementConnectionString: string;
	opsWebConnectionString: string;
	opsWebDiningConnectionString: string;
}

declare module "vitest" {
	export interface ProvidedContext {
		opsWebPostgres: OpsWebPostgresContext;
	}
}

function roleConnectionString(connectionString: string, role: string, password: string): string {
	const url = new URL(connectionString);
	url.username = role;
	url.password = password;
	return url.toString();
}

async function installExecutionControlSchema(connectionString: string): Promise<void> {
	const evidenceDirectory = await mkdtemp(join(tmpdir(), "ops-web-execution-schema-"));
	const databaseUrl = new URL(connectionString);
	databaseUrl.searchParams.set("sslmode", "disable");
	try {
		await execFileAsync(
			"go",
			[
				"run",
				"./cmd/run-projection-schema",
				"--mode",
				"install",
				"--database-url",
				databaseUrl.toString(),
				"--evidence-path",
				join(evidenceDirectory, "schema.json"),
			],
			{ cwd: executionControlRoot, maxBuffer: 10 * 1024 * 1024 },
		);
	} finally {
		await rm(evidenceDirectory, { force: true, recursive: true });
	}
}

async function provisionDatabase(
	container: StartedPostgreSqlContainer,
): Promise<OpsWebPostgresContext> {
	const adminConnectionString = container.getConnectionUri();
	const schemaOwnerPassword = randomBytes(24).toString("hex");
	const opsWebPassword = randomBytes(24).toString("hex");
	const opsWebDiningPassword = randomBytes(24).toString("hex");
	const admin = new Client({ connectionString: adminConnectionString, ssl: false });
	await admin.connect();
	try {
		await admin.query(`create role "${SCHEMA_OWNER}" login password '${schemaOwnerPassword}'`);
		await admin.query(`create role "${OPS_WEB_ROLE}" login password '${opsWebPassword}'`);
		await admin.query(
			`create role "${OPS_WEB_DINING_ROLE}" login password '${opsWebDiningPassword}'`,
		);
		for (const role of NOLOGIN_ROLES) {
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
	const opsWebConnectionString = roleConnectionString(
		adminConnectionString,
		OPS_WEB_ROLE,
		opsWebPassword,
	);
	const opsWebDiningConnectionString = roleConnectionString(
		adminConnectionString,
		OPS_WEB_DINING_ROLE,
		opsWebDiningPassword,
	);
	await installCampusServicesSchema({ connectionString: managementConnectionString, ssl: false });
	await installAppApiSchema({
		APP_API_DATABASE_SSLMODE: "disable",
		APP_API_SCHEMA_DATABASE_URL: managementConnectionString,
		AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
		BETTER_AUTH_SECRET: "testcontainers-ops-web-product-database-secret",
	});
	await installExecutionControlSchema(managementConnectionString);
	await migrateDining(managementConnectionString);

	return {
		managementConnectionString,
		opsWebConnectionString,
		opsWebDiningConnectionString,
	};
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
	let container: StartedPostgreSqlContainer | undefined;
	try {
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withResourcesQuota({ cpu: 1, memory: 512 * 1024 * 1024 })
			.withDatabase(DATABASE_NAME)
			.withUsername("postgres")
			.withPassword(randomUUID())
			.start();
		project.provide("opsWebPostgres", await provisionDatabase(container));
	} catch (error) {
		await container?.stop();
		throw error;
	}

	return async () => {
		await container?.stop();
	};
}
