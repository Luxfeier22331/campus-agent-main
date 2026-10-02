import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createFilesystemArtifactStore } from "../../../jobs/campus-docs-index-publisher/src/filesystem-artifact-store.ts";
import { buildCampusDocsChunkSet } from "../../../jobs/campus-docs-index-publisher/src/publisher.ts";
import {
	readDocsEmbeddingSet,
	readNoticeEmbeddingSet,
} from "../../../jobs/campus-rag-index-publisher/src/artifacts.ts";
import { createTransactionalIndexCatalog } from "../../../jobs/campus-rag-index-publisher/src/catalog.ts";
import { writeStoredNoticeChunks } from "../../../jobs/notice-index-publisher/src/artifacts.ts";
import { buildNoticeChunkRun } from "../../../jobs/notice-index-publisher/src/command.ts";
import { importProductData, importRetrievalData } from "./product-data-database.ts";
import { parseProductDataOptions } from "./product-data-options.ts";
import {
	copyDocsClosure,
	copyProductAssets,
	validateProductPoint,
} from "./product-data-resources.ts";
import { createProductSeed } from "./product-data-seed.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");

test("cluster import defaults namespace to staging and allows kubectl current-context fallback", () => {
	assert.deepEqual(parseProductDataOptions([]), {
		data: "seed",
		replace: false,
		context: undefined,
		namespace: undefined,
	});
	// cluster without flags: namespace defaults to staging, context falls back to
	// the developer's own kubectl current-context (undefined here).
	assert.deepEqual(parseProductDataOptions(["--data", "cluster"]), {
		data: "cluster",
		replace: false,
		context: undefined,
		namespace: "campus-agent-staging",
	});
	// explicit namespace overrides the staging default; explicit context wins too.
	assert.deepEqual(
		parseProductDataOptions(["--data", "cluster", "--context", "prod", "--namespace", "other"]),
		{ data: "cluster", replace: false, context: "prod", namespace: "other" },
	);
	// seed mode still rejects cluster-only flags.
	assert.throws(() => parseProductDataOptions(["--context", "staging"]), /require --data cluster/u);
	assert.throws(
		() => parseProductDataOptions(["--namespace", "staging"]),
		/require --data cluster/u,
	);
	assert.equal(
		parseProductDataOptions([
			"--data",
			"cluster",
			"--context",
			"collaborator",
			"--namespace",
			"staging",
			"--replace",
		]).replace,
		true,
	);
});

test("committed real seed embeddings match current builders, source resources and citations", async () => {
	const seed = createProductSeed(new Date("2026-09-18T00:00:00Z"));
	for (const table of [
		"notices.notices",
		"campus_groups.groups",
		"transport.routes",
		"dining.map_publication",
	] as const) {
		assert(seed.rows[table].length > 0, `seed fixture covers ${table}`);
	}
	const source = {
		async read(key: string) {
			const object = seed.objects.get(key);
			assert(object, key);
			return object.body;
		},
	};
	const docs = await copyDocsClosure(source);
	await copyProductAssets(seed.rows, source);
	const candidate = await readProductSeedIndex(repoRoot);
	for (const point of candidate.points) {
		validateProductPoint(point, seed.rows, docs.references);
		validateProductPoint(
			{ ...point, payload: { ...point.payload, schema_version: "campus_rag_point.v2" } },
			seed.rows,
			docs.references,
		);
	}
	assert(candidate.points.some((point) => point.payload.source_kind === "notice"));
	assert(candidate.points.every((point) => point.vector.dense.length === 2560));
	const directory = resolve(repoRoot, "scripts/dev/product-data/fixtures/product-data");
	const binding = JSON.parse(await readFile(resolve(directory, "index.json"), "utf8"));
	const artifacts = createFilesystemArtifactStore(directory);
	const generated = new Map<string, Uint8Array>();
	const sink = {
		...source,
		async writeImmutable(key: string, body: Uint8Array) {
			generated.set(key, body);
		},
		async list() {
			return [];
		},
		async writeImmutableFile() {
			throw new Error("unexpected embedding generation");
		},
	};
	const chunks = await buildCampusDocsChunkSet({ sourceStore: source, artifactStore: sink });
	assert.equal(
		chunks.chunkSet,
		(await readDocsEmbeddingSet(artifacts, binding.docsEmbeddingSet)).manifest.chunkSet,
	);
	const notices = await writeStoredNoticeChunks({
		artifactStore: sink,
		...buildNoticeChunkRun({
			sources: seed.rows["notices.notices"]
				.filter((row) => row.is_published && !row.is_external)
				.map((row) => ({
					noticeId: String(row.notice_id),
					title: String(row.title),
					contentText: String(row.content_text),
					releasedAt: new Date(String(row.released_at)).toISOString(),
				})),
		}),
	});
	const noticeManifest = (await readNoticeEmbeddingSet(artifacts, binding.noticeEmbeddingSet))
		.manifest;
	assert.equal(noticeManifest.schemaVersion, "notice_embedding_set.v2");
	assert(noticeManifest.schemaVersion === "notice_embedding_set.v2");
	assert.deepEqual(notices.chunks, noticeManifest.chunks);
	const noticePoint = candidate.points.find((point) => point.payload.source_kind === "notice");
	assert(noticePoint);
	const unpublished = { ...noticePoint };
	unpublished.payload = { ...unpublished.payload, notice_id: "900004" };
	assert.throws(
		() => validateProductPoint(unpublished, seed.rows, docs.references),
		/published local detail/u,
	);
});

test("copies the Docs closure from the bytes already read during compilation", async () => {
	const seed = createProductSeed(new Date("2026-09-18T00:00:00Z"));
	const reads = new Map<string, number>();
	const writes = new Map<string, number>();
	const source = {
		async read(key: string) {
			reads.set(key, (reads.get(key) ?? 0) + 1);
			const object = seed.objects.get(key);
			assert(object, key);
			return object.body;
		},
	};
	await copyDocsClosure(source, {
		async read() {
			throw new Error("unexpected target read");
		},
		async readIfExists(): Promise<Uint8Array | undefined> {
			// The closure copy path never reads from its target.
			return;
		},
		async writeImmutable(key: string, bytes: Uint8Array) {
			assert.deepEqual(bytes, seed.objects.get(key)?.body);
			writes.set(key, (writes.get(key) ?? 0) + 1);
			return "created";
		},
	});

	assert([...reads.values()].every((count) => count === 1));
	assert([...writes.values()].every((count) => count === 1));
	assert.deepEqual(
		[...reads.keys()].filter((key) => key !== "campus-docs/source.json").sort(),
		[...writes.keys()].sort(),
	);
});

test("transactional catalog never commits the caller's foundation import", async () => {
	const statements: string[] = [];
	const query = async (sql: string) => {
		statements.push(sql);
		return { rows: sql.includes("SELECT validated") ? [{ validated: true }] : [], rowCount: 0 };
	};
	await createTransactionalIndexCatalog({ query } as never).activate({
		collection: `campus_docs_${"a".repeat(64)}`,
	});
	assert(statements.some((sql) => sql.startsWith("insert")));
	assert(!statements.some((sql) => /BEGIN|COMMIT/u.test(sql)));
});

test("failed foundation import rolls back and never activates the index", async () => {
	const statements: string[] = [];
	const query = async (sql: string) => {
		statements.push(sql);
		if (sql.startsWith("insert into notices.notices")) {
			throw new Error("invalid notice foreign key");
		}
		return { rows: [], rowCount: 0 };
	};
	await assert.rejects(
		importProductData({ query } as never, {
			rows: createProductSeed(new Date()).rows,
			collection: `campus_docs_${"a".repeat(64)}`,
			replace: true,
			docsEmbeddingSet: `sha256:${"a".repeat(64)}`,
			noticeEmbeddingSet: `sha256:${"b".repeat(64)}`,
		}),
		/foreign key/u,
	);
	assert.equal(statements.at(-1), "ROLLBACK");
	assert(!statements.some((sql) => sql.includes("insert into campus_docs_serving")));
});

test("retrieval import registers and validates the candidate before activation", async () => {
	const statements: string[] = [];
	const docsEmbeddingSet = `sha256:${"a".repeat(64)}` as const;
	const noticeEmbeddingSet = `sha256:${"b".repeat(64)}` as const;
	const collection = `campus_docs_${"c".repeat(64)}`;
	const seed = createProductSeed(new Date());
	const query = async (sql: string) => {
		statements.push(sql);
		if (sql.includes("SELECT v.*, EXISTS")) {
			return {
				rows: [
					{
						collection,
						docs_embedding_set: docsEmbeddingSet,
						notice_embedding_set: noticeEmbeddingSet,
						producer: "manual",
						validated: false,
						activated_at: null,
						protected: false,
					},
				],
				rowCount: 1,
			};
		}
		if (sql.startsWith("SELECT validated")) {
			return { rows: [{ validated: true }], rowCount: 1 };
		}
		if (sql.includes("current_index") && sql.includes("FOR UPDATE")) {
			return { rows: [], rowCount: 0 };
		}
		return { rows: [], rowCount: 1 };
	};
	await importRetrievalData({ query } as never, {
		rows: {
			"notices.categories": seed.rows["notices.categories"],
			"notices.notice_types": seed.rows["notices.notice_types"],
			"notices.organizations": seed.rows["notices.organizations"],
			"notices.notices": seed.rows["notices.notices"],
			"notices.notice_assets": seed.rows["notices.notice_assets"],
		},
		collection,
		docsEmbeddingSet,
		noticeEmbeddingSet,
	});
	assert(statements.some((sql) => sql.includes("SET validated=true")));
	assert(statements.some((sql) => sql.includes("insert into campus_docs_serving.current_index")));
	assert(
		statements.some(
			(sql) =>
				sql.includes("transport.schedule_period_notices") &&
				sql.includes("notices.processing_failures"),
		),
	);
	assert(
		statements.some(
			(sql) =>
				sql.includes("delete from notices.notices") &&
				sql.includes("where link.notice_id = notice.notice_id") &&
				sql.includes("where failure.notice_id = notice.notice_id"),
		),
	);
	assert(statements.some((sql) => sql.includes('on conflict ("notice_id") do update')));
	assert.equal(statements.at(-1), "COMMIT");
});
