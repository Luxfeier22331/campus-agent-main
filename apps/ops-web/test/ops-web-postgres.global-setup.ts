import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { Wait } from "testcontainers";
import type { TestProject } from "vitest/node";

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent";
const SCHEMA_OWNER = "campus_agent";
const OPS_WEB_ROLE = "ops_web";
const APP_API_ROLE = "app_api";
const NOLOGIN_ROLES = [
	"agent_control",
	"campus_search",
	"model_config",
	"product_data_ro",
] as const;
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface OpsWebPostgresContext {
	appApiConnectionString: string;
	managementConnectionString: string;
	opsWebConnectionString: string;
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

function postgresEnvironment(connectionString: string): NodeJS.ProcessEnv {
	const url = new URL(connectionString);
	return {
		...process.env,
		PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
		PGHOST: url.hostname,
		PGPASSWORD: decodeURIComponent(url.password),
		PGPORT: url.port || "5432",
		PGSSLMODE: "disable",
		PGUSER: decodeURIComponent(url.username),
	};
}

async function installUnifiedSchema(connectionString: string): Promise<void> {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	await execFileAsync(pnpm, ["--dir", "jobs/campus-agent-schema", "migrate"], {
		cwd: repositoryRoot,
		env: postgresEnvironment(connectionString),
		maxBuffer: 10 * 1024 * 1024,
	});
}

async function provisionDatabase(
	container: StartedPostgreSqlContainer,
): Promise<OpsWebPostgresContext> {
	const adminConnectionString = container.getConnectionUri();
	const schemaOwnerPassword = randomBytes(24).toString("hex");
	const opsWebPassword = randomBytes(24).toString("hex");
	const appApiPassword = randomBytes(24).toString("hex");
	const admin = new Client({ connectionString: adminConnectionString, ssl: false });
	await admin.connect();
	try {
		await admin.query(`create role "${SCHEMA_OWNER}" login password '${schemaOwnerPassword}'`);
		await admin.query(`create role "${OPS_WEB_ROLE}" login password '${opsWebPassword}'`);
		await admin.query(`create role "${APP_API_ROLE}" login password '${appApiPassword}'`);
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
	await installUnifiedSchema(managementConnectionString);

	return {
		appApiConnectionString: roleConnectionString(
			adminConnectionString,
			APP_API_ROLE,
			appApiPassword,
		),
		managementConnectionString,
		opsWebConnectionString: roleConnectionString(
			adminConnectionString,
			OPS_WEB_ROLE,
			opsWebPassword,
		),
	};
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
			.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
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
