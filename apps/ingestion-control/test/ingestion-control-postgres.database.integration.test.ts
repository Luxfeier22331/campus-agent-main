// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runIngestionControlMigrations } from "../src/migrate";
import { runIngestionControlSchemaBootstrap } from "../src/schema-bootstrap";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent_ingestion_test";

function roleConnectionString(connectionString: string, password: string): string {
	const url = new URL(connectionString);
	url.username = "ingestion_control";
	url.password = password;
	return url.toString();
}

describe("ingestion-control PostgreSQL lifecycle", () => {
	let adminConnectionString = "";
	let container: StartedPostgreSqlContainer;
	let runtimeConnectionString = "";

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withDatabase(DATABASE_NAME)
			.withUsername("postgres")
			.withPassword(randomUUID())
			.start();
		adminConnectionString = container.getConnectionUri();
		const password = randomBytes(24).toString("hex");
		const admin = new Client({ connectionString: adminConnectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(`CREATE ROLE ingestion_control LOGIN PASSWORD '${password}'`);
		} finally {
			await admin.end();
		}
		runtimeConnectionString = roleConnectionString(adminConnectionString, password);
	}, 180_000);

	afterAll(async () => {
		await container?.stop();
	}, 60_000);

	it("bootstraps, migrates idempotently, and limits the application role to its schema", async () => {
		const localEnvironment = {
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: runtimeConnectionString,
			INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_SCHEMA_DATABASE_URL: adminConnectionString,
		};

		await runIngestionControlSchemaBootstrap(localEnvironment);
		await runIngestionControlSchemaBootstrap(localEnvironment);
		await expect(runIngestionControlMigrations(localEnvironment)).resolves.toEqual([
			"0001_tasks.sql",
			"0002_offline_releases.sql",
			"0003_offline_release_checks.sql",
		]);
		await expect(runIngestionControlMigrations(localEnvironment)).resolves.toEqual([]);

		const runtime = new Client({ connectionString: runtimeConnectionString, ssl: false });
		await runtime.connect();
		try {
			await expect(
				runtime.query("CREATE TABLE ingestion_control.permission_probe (id integer PRIMARY KEY)"),
			).resolves.toMatchObject({ command: "CREATE" });
			await expect(runtime.query("CREATE SCHEMA forbidden_probe")).rejects.toThrow(
				"permission denied for database",
			);
		} finally {
			await runtime.end();
		}
	});
});
