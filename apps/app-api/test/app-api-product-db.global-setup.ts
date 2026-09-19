import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

const POSTGRES_IMAGE =
	"postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent";
const SCHEMA_OWNER = "campus_agent";
const RUNTIME_ROLE = "app_api";
const SUPPORTING_ROLES = [
	"execution_control",
	"ops_web",
	"model_config",
	"product_data_ro",
] as const;

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

function randomHex(length: number): string {
	let value = "";
	while (value.length < length) {
		value += randomUUID().replaceAll("-", "");
	}
	return value.slice(0, length);
}

async function provisionDatabase(
	container: StartedPostgreSqlContainer,
): Promise<AppApiPostgresContext> {
	const adminConnectionString = container.getConnectionUri();
	const schemaOwnerPassword = randomHex(48);
	const runtimePassword = randomHex(48);
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

	const url = new URL(managementConnectionString);
	await promisify(execFile)(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["--dir", "jobs/campus-agent-schema", "migrate"],
		{
			cwd: fileURLToPath(new URL("../../../", import.meta.url)),
			env: {
				...process.env,
				PGHOST: url.hostname,
				PGPORT: url.port,
				PGDATABASE: DATABASE_NAME,
				PGUSER: SCHEMA_OWNER,
				PGPASSWORD: schemaOwnerPassword,
				PGSSLMODE: "disable",
			},
		},
	);

	return { managementConnectionString, runtimeConnectionString };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
	let container: StartedPostgreSqlContainer | undefined;
	try {
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withResourcesQuota({ cpu: 1, memory: 0.5 })
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
