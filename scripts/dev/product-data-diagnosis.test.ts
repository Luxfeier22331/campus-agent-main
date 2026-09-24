import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "pg";
import { ensureLocalInfrastructureSecrets } from "./infrastructure-secrets.ts";
import { diagnoseProductData, initializeProductData } from "./product-data.ts";
import { parseProductDataOptions } from "./product-data-options.ts";
import { createProductSeed } from "./product-data-seed.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";
import {
	calculateLocalDevInfrastructurePorts,
	calculateLocalDevPorts,
	type LocalDevProfile,
} from "./profile.ts";

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "product-diagnosis-"));
	const previousStateHome = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = directory;
	t.after(async () => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		if (previousStateHome === undefined) {
			delete process.env.XDG_STATE_HOME;
		} else {
			process.env.XDG_STATE_HOME = previousStateHome;
		}
		await rm(directory, { recursive: true, force: true });
	});
	const seed = createProductSeed(new Date("2026-09-18T00:00:00Z"));
	const index = await readProductSeedIndex(join(import.meta.dirname, "../.."));
	const state = { collection: index.collection, indexStatus: 200 };
	const queries: string[] = [];
	const reads: string[] = [];
	const requests: string[] = [];
	t.mock.method(Client.prototype, "connect", async () => undefined);
	t.mock.method(Client.prototype, "end", async () => undefined);
	t.mock.method(Client.prototype, "query", async (sql: string) => {
		queries.push(sql);
		if (sql.includes("from campus_docs_serving.current_index")) {
			return {
				rows: state.collection
					? [
							{
								collection: state.collection,
								docs_embedding_set: index.docsEmbeddingSet,
								notice_embedding_set: index.noticeEmbeddingSet,
							},
						]
					: [],
			};
		}
		for (const [table, rows] of Object.entries(seed.rows)) {
			if (sql.includes(`from ${table}`)) {
				return {
					rows: sql.startsWith("select 1 ") ? rows.slice(0, 1) : rows.map((row) => ({ row })),
				};
			}
		}
		if (!/^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT)$/u.test(sql)) {
			throw new Error(`Unexpected database operation during diagnosis: ${sql}`);
		}
		return { rows: [] };
	});
	t.mock.method(S3Client.prototype, "send", async (command: GetObjectCommand) => {
		assert(command instanceof GetObjectCommand, "preserving data must not write objects");
		const key = command.input.Key ?? "";
		reads.push(key);
		const object = seed.objects.get(key);
		if (!object) {
			throw Object.assign(new Error(`Missing object: ${key}`), { name: "NoSuchKey" });
		}
		return { Body: { transformToByteArray: async () => object.body } };
	});
	t.mock.method(childProcess, "execFileSync", () => directory);
	t.mock.method(childProcess, "spawnSync", (command: string) => {
		if (command !== "docker") {
			throw new Error(`Unexpected command during diagnosis: ${command}`);
		}
		return {
			status: 0,
			stderr: "",
			stdout: JSON.stringify([
				{
					Config: {
						Env: ["QDRANT__SERVICE__API_KEY=test", "QDRANT__SERVICE__READ_ONLY_API_KEY=test-read"],
					},
					State: { Running: true },
					NetworkSettings: { Ports: { "6333/tcp": [{ HostIp: "127.0.0.1", HostPort: "6333" }] } },
				},
			]),
		};
	});
	syncBuiltinESMExports();
	t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
		const path = new URL(String(url)).pathname;
		requests.push(path);
		let result: unknown;
		if (path.endsWith("/count")) {
			result = { count: index.points.length };
		} else if (path.endsWith("/scroll")) {
			result = { points: index.points, next_page_offset: null };
		} else {
			result = {
				config: {
					params: {
						vectors: { dense: { size: 2560, distance: "Cosine" } },
						sparse_vectors: { sparse: { modifier: "idf" } },
					},
				},
			};
		}
		return Response.json({ result }, { status: path === "/collections" ? 200 : state.indexStatus });
	});
	const profile: LocalDevProfile = {
		bucketName: "test",
		createdAt: "2026-09-18",
		databaseName: "test",
		instanceId: "test",
		ports: calculateLocalDevPorts(99),
		repoKey: "test",
		resourceKey: "test",
		schemaVersion: 3,
		infraPorts: calculateLocalDevInfrastructurePorts(99),
		infraProject: "campus-agent-test",
		sourceBucketName: "test-source",
		slot: 99,
		worktreePath: directory,
	};
	ensureLocalInfrastructureSecrets(directory, profile);
	return { directory, profile, seed, state, queries, reads, requests };
}

test("default diagnosis accepts empty business tables and reads only required entries", async (t) => {
	const f = await fixture(t);
	for (const table of Object.keys(f.seed.rows) as Array<keyof typeof f.seed.rows>) {
		f.seed.rows[table] = [];
	}
	assert.deepEqual(await diagnoseProductData(f.directory, f.profile), { state: "ready" });
	assert.equal(f.queries.length, 1);
	assert.deepEqual(f.reads, ["campus-docs/source.json"]);
	assert.deepEqual(f.requests, ["/collections", `/collections/${f.state.collection}`]);
});

test("default diagnosis reports missing source, binding and unavailable collection", async (t) => {
	const f = await fixture(t);
	f.state.indexStatus = 404;
	assert.match((await diagnoseProductData(f.directory, f.profile)).reason ?? "", /HTTP 404/u);
	f.seed.objects.delete("campus-docs/source.json");
	assert.deepEqual(await diagnoseProductData(f.directory, f.profile), {
		state: "missing",
		reason: "Local Docs source is missing",
	});
	f.state.collection = "";
	assert.deepEqual(await diagnoseProductData(f.directory, f.profile), {
		state: "missing",
		reason: "Product data has no current index",
	});
});

test("explicit data diagnosis accepts empty unrelated domains and rejects broken references", async (t) => {
	const f = await fixture(t);
	for (const table of Object.keys(f.seed.rows) as Array<keyof typeof f.seed.rows>) {
		if (!table.startsWith("notices.")) {
			f.seed.rows[table] = [];
		}
	}
	assert.deepEqual(await diagnoseProductData(f.directory, f.profile, true), { state: "ready" });
	assert.equal(f.reads.filter((key) => key === "campus-docs/source.json").length, 1);
	assert.equal(
		f.requests.filter((path) => path === `/collections/${f.state.collection}`).length,
		1,
	);
	assert(f.requests.some((path) => path.endsWith("/scroll")));
	f.seed.rows["notices.notices"] = [];
	assert.match(
		(await diagnoseProductData(f.directory, f.profile, true)).reason ?? "",
		/published local detail/u,
	);
	const objectKey = [...f.seed.objects.keys()].find((key) => key !== "campus-docs/source.json");
	assert(objectKey);
	f.seed.objects.delete(objectKey);
	assert.match(
		(await diagnoseProductData(f.directory, f.profile, true)).reason ?? "",
		/Missing object/u,
	);
});

test("repeated seed initialization preserves edits without object traversal or index scroll", async (t) => {
	const f = await fixture(t);
	f.seed.rows["notices.notices"][0].title = "Local edit";
	const before = structuredClone(f.seed.rows);
	await initializeProductData(f.directory, f.profile, parseProductDataOptions([]));
	assert.deepEqual(f.seed.rows, before);
	assert(f.reads.every((key) => key === "campus-docs/source.json"));
	assert(!f.requests.some((path) => path.endsWith("/scroll")));
	assert(!f.queries.some((sql) => sql.startsWith("select row_to_json")));
	assert.throws(
		() => parseProductDataOptions(["--data", "cluster"]),
		/Cluster initialization requires explicit --context and --namespace/u,
	);
});
