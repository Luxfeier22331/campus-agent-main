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
import { INDEX_DEFINITION } from "../src/types.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

describe("Campus docs publisher PostgreSQL catalog", () => {
	let connectionString = "";
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
		const client = new Client({ connectionString, ssl: false });
		await client.connect();
		try {
			await client.query(`
				create schema campus_docs_serving;
				create table campus_docs_serving.current_index (
					singleton boolean primary key default true check (singleton),
					collection text not null,
					dense_vector_name text not null,
					embedding_dimensions integer not null,
					embedding_query_instruction text not null,
					embedding_space_id text not null,
					sparse_model text not null,
					sparse_vector_name text not null
				)
			`);
		} finally {
			await client.end();
		}
	}, 180_000);

	afterAll(async () => {
		await container?.stop();
	}, 60_000);

	it("reads an older binding and replaces it with the current definition", async () => {
		const admin = new Client({ connectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(
				`insert into campus_docs_serving.current_index
				 (singleton, collection, dense_vector_name, embedding_dimensions,
				  embedding_query_instruction, embedding_space_id, sparse_model,
				  sparse_vector_name)
				 values (true, $1, 'legacy_dense', 1024, 'legacy instruction',
				         'legacy-space', 'legacy-sparse', 'legacy_sparse')`,
				[`campus_docs_${"a".repeat(64)}`],
			);
		} finally {
			await admin.end();
		}

		const catalog = createPostgresIndexCatalog(catalogEnv(connectionString));
		try {
			await expect(catalog.current()).resolves.toMatchObject({
				embedding_dimensions: 1024,
				embedding_space_id: "legacy-space",
			});
			const target = targetBinding("b");
			await expect(catalog.activate(target)).resolves.toEqual({ noOp: false });
			await expect(catalog.current()).resolves.toEqual(target);
		} finally {
			await catalog.close();
		}
	});

	it("rejects concurrent publisher sessions and releases the lock on close", async () => {
		const first = createPostgresIndexCatalog(catalogEnv(connectionString));
		const second = createPostgresIndexCatalog(catalogEnv(connectionString));
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

	it("checks every field when activation sees the same collection", async () => {
		const target = targetBinding("c");
		const admin = new Client({ connectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(
				`update campus_docs_serving.current_index
				    set collection = $1, embedding_query_instruction = 'conflicting instruction'`,
				[target.collection],
			);
		} finally {
			await admin.end();
		}
		const catalog = createPostgresIndexCatalog(catalogEnv(connectionString));
		try {
			await expect(catalog.activate(target)).rejects.toThrow(
				"Campus docs current index conflicts at embedding_query_instruction",
			);
		} finally {
			await catalog.close();
		}
	});
});

function targetBinding(digestCharacter: string): CurrentIndexBinding {
	return {
		collection: `campus_docs_${digestCharacter.repeat(64)}`,
		dense_vector_name: INDEX_DEFINITION.embedding.vectorName,
		embedding_dimensions: INDEX_DEFINITION.embedding.dimensions,
		embedding_query_instruction: INDEX_DEFINITION.embedding.queryInstruction,
		embedding_space_id: INDEX_DEFINITION.embedding.spaceId,
		sparse_model: INDEX_DEFINITION.sparse.model,
		sparse_vector_name: INDEX_DEFINITION.sparse.vectorName,
	};
}

function catalogEnv(connectionString: string): PostgresCatalogEnv {
	const parsed = new URL(connectionString);
	return {
		PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
		PGHOST: parsed.hostname,
		PGPASSWORD: decodeURIComponent(parsed.password),
		PGPORT: parsed.port,
		PGSSLMODE: "disable",
		PGUSER: decodeURIComponent(parsed.username),
	};
}
