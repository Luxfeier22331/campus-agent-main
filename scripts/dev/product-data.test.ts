import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createFilesystemArtifactStore } from "../../jobs/campus-docs-index-publisher/src/filesystem-artifact-store.ts";
import { buildCampusDocsChunkSet } from "../../jobs/campus-docs-index-publisher/src/publisher.ts";
import {
	readDocsEmbeddingSet,
	readNoticeEmbeddingSet,
} from "../../jobs/campus-rag-index-publisher/src/artifacts.ts";
import { createTransactionalIndexCatalog } from "../../jobs/campus-rag-index-publisher/src/catalog.ts";
import { writeStoredChunkRun } from "../../jobs/notice-index-publisher/src/artifacts.ts";
import { buildNoticeChunkRun } from "../../jobs/notice-index-publisher/src/command.ts";
import { importProductData } from "./product-data-database.ts";
import { parseProductDataOptions } from "./product-data-options.ts";
import {
	copyDocsClosure,
	copyProductAssets,
	validateProductPoint,
} from "./product-data-resources.ts";
import { createProductSeed } from "./product-data-seed.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

test("cluster import requires explicit source identity and replacement is opt-in", () => {
	assert.deepEqual(parseProductDataOptions([]), {
		data: "seed",
		replace: false,
		context: undefined,
		namespace: undefined,
	});
	assert.throws(() => parseProductDataOptions(["--data", "cluster"]), /explicit/u);
	assert.throws(() => parseProductDataOptions(["--context", "staging"]), /require --data cluster/u);
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
	}
	assert(candidate.points.some((point) => point.payload.source_kind === "notice"));
	assert(candidate.points.every((point) => point.vector.dense.length === 2560));
	const directory = resolve(repoRoot, "scripts/dev/fixtures/product-data");
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
	const notices = await writeStoredChunkRun({
		artifactStore: sink,
		...buildNoticeChunkRun({
			sources: seed.rows["notices.notices"]
				.filter((row) => row.is_published && !row.is_external)
				.map((row) => ({
					noticeId: String(row.notice_id),
					title: String(row.title),
					contentText: String(row.content_text),
				})),
		}),
	});
	assert.equal(
		notices.run,
		(await readNoticeEmbeddingSet(artifacts, binding.noticeEmbeddingSet)).manifest.chunkRun,
	);
	const noticePoint = candidate.points.find((point) => point.payload.source_kind === "notice");
	assert(noticePoint);
	const unpublished = { ...noticePoint };
	unpublished.payload = { ...unpublished.payload, notice_id: "900004" };
	assert.throws(
		() => validateProductPoint(unpublished, seed.rows, docs.references),
		/published local detail/u,
	);
});

test("transactional catalog never commits the caller's foundation import", async () => {
	const statements: string[] = [];
	const query = async (sql: string) => {
		statements.push(sql);
		return { rows: [], rowCount: 0 };
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
		}),
		/foreign key/u,
	);
	assert.equal(statements.at(-1), "ROLLBACK");
	assert(!statements.some((sql) => sql.includes("insert into campus_docs_serving")));
});
