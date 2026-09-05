// @vitest-environment node

import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	createPostgresIndexCatalog,
	type PostgresCatalogEnv,
} from "../src/catalog.ts";
import type { CurrentIndexBinding } from "../src/types.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

describe("Campus docs publisher PostgreSQL catalog", () => {
	let connectionString = "";
	let executionControlConnectionString = "";
	let container: StartedPostgreSqlContainer;

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withResourcesQuota({ cpu: 1, memory: 0.5 })
			.withDatabase("campus_docs_publisher_test")
			.withUsername("postgres")
			.withPassword(randomUUID())
			.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
			.start();
		connectionString = container.getConnectionUri();
		const executionControlPassword = randomUUID();
		const client = new Client({ connectionString, ssl: false });
		await client.connect();
		try {
			await client.query(
				`create role execution_control login password '${executionControlPassword}'`,
			);
			await client.query(`
				create schema campus_docs_serving;
				create table campus_docs_serving.current_index (
					singleton boolean primary key default true check (singleton),
					collection text not null check (collection ~ '^campus_docs_[a-f0-9]{64}$')
				)
			`);
			await client.query(
				"grant usage on schema campus_docs_serving to execution_control",
			);
			await client.query(
				"grant select, insert, update on table campus_docs_serving.current_index to execution_control",
			);
		} finally {
			await client.end();
		}
		const executionControlURL = new URL(connectionString);
		executionControlURL.username = "execution_control";
		executionControlURL.password = executionControlPassword;
		executionControlConnectionString = executionControlURL.toString();
	}, 180_000);

	afterAll(async () => {
		await container?.stop();
	}, 60_000);

	it("replaces the current collection pointer", async () => {
		const admin = new Client({ connectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(
				`insert into campus_docs_serving.current_index
				 (singleton, collection)
				 values (true, $1)`,
				[`campus_docs_${"a".repeat(64)}`],
			);
		} finally {
			await admin.end();
		}

		const target = targetBinding("b");
		const catalog = createPostgresIndexCatalog(catalogEnv(executionControlConnectionString));
		try {
			await expect(catalog.activate(target)).resolves.toEqual({ noOp: false });
		} finally {
			await catalog.close();
		}
		const verify = new Client({ connectionString, ssl: false });
		await verify.connect();
		try {
			const result = await verify.query<{ collection: string }>(
				"select collection from campus_docs_serving.current_index where singleton = true",
			);
			expect(result.rows).toEqual([target]);
		} finally {
			await verify.end();
		}
	});

	it("rejects concurrent publisher sessions and releases the lock on close", async () => {
		const first = createPostgresIndexCatalog(catalogEnv(executionControlConnectionString));
		const second = createPostgresIndexCatalog(catalogEnv(executionControlConnectionString));
		try {
			await first.acquirePublisherLock();
			await expect(second.acquirePublisherLock()).rejects.toThrow(
				"another Campus docs index publisher is already running",
			);
			await first.close();
			await expect(second.acquirePublisherLock()).resolves.toBeUndefined();
		} finally {
			await first.close();
			await second.close();
		}
	});

	it("treats the same collection pointer as a no-op", async () => {
		const target = targetBinding("c");
		const admin = new Client({ connectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(
				`update campus_docs_serving.current_index
				    set collection = $1`,
				[target.collection],
			);
		} finally {
			await admin.end();
		}
		const catalog = createPostgresIndexCatalog(catalogEnv(executionControlConnectionString));
		try {
			await expect(catalog.activate(target)).resolves.toEqual({ noOp: true });
		} finally {
			await catalog.close();
		}
	});
});

function targetBinding(digestCharacter: string): CurrentIndexBinding {
	return {
		collection: `campus_docs_${digestCharacter.repeat(64)}`,
	};
}

function catalogEnv(connectionString: string): PostgresCatalogEnv {
	return {
		EXECUTION_CONTROL_DATABASE_URL: connectionString,
	};
}
