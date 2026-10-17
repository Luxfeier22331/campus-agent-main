import { expect, it } from "vitest";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { withRetrievalExportLock } from "../../../scripts/dev/product-data/product-data-database.ts";
import { cleanupArtifacts } from "../src/cleanup-job.ts";
import type { ArtifactStore } from "../src/stream-store.ts";
import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { applyIndex, qdrantRequest } from "../src/apply.ts";
import { bindingCollection } from "../src/catalog.ts";
import { createQdrantClient } from "../src/qdrant.ts";
import { canonical, digest } from "../src/workspace.ts";
import type { Sha256Ref } from "../src/types.ts";
const enabled = Boolean(
	process.env.RETRIEVAL_TEST_DATABASE_URL && process.env.RETRIEVAL_TEST_QDRANT_URL,
);
it.skipIf(!enabled)(
	"applies versioned collections online with real PostgreSQL/Qdrant",
	async () => {
		const env = {
			...process.env,
			AGENT_CONTROL_DATABASE_URL: process.env.RETRIEVAL_TEST_DATABASE_URL!,
			QDRANT_URL: process.env.RETRIEVAL_TEST_QDRANT_URL!,
			QDRANT_API_KEY: process.env.RETRIEVAL_TEST_QDRANT_KEY!,
		};
		const db = new Client({ connectionString: env.AGENT_CONTROL_DATABASE_URL });
		const reader = new Client({ connectionString: env.AGENT_CONTROL_DATABASE_URL });
		await db.connect();
		await reader.connect();
		const root = resolve(
			import.meta.dirname,
			"../../../scripts/dev/product-data/fixtures/product-data",
		);
		const binding = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
		const extra = new Map<string, Uint8Array>();
		const store = {
			read: async (key: string) => extra.get(key) ?? (await readFile(resolve(root, key))),
			async *stream(key: string) {
				if (extra.has(key)) yield extra.get(key)!;
				else yield* createReadStream(resolve(root, key), { highWaterMark: 127 });
			},
		};
		const request = qdrantRequest(env);
		const qdrantClient = createQdrantClient(env);
		const apply = (notices: Sha256Ref = binding.noticeEmbeddingSet, graceMs = 0) =>
			applyIndex({ store, docs: binding.docsEmbeddingSet, notices, env, graceMs });
		const current = async () =>
			(
				await db.query(
					"SELECT collection,docs_embedding_set,notice_embedding_set FROM campus_docs_serving.current_index",
				)
			).rows[0];
		const exists = async (name: string) =>
			(await request("/collections")).result.collections.some((c: any) => c.name === name);
		try {
			await db.query(`DROP SCHEMA IF EXISTS campus_docs_serving CASCADE;CREATE SCHEMA campus_docs_serving;
  CREATE TABLE campus_docs_serving.current_index(singleton boolean PRIMARY KEY DEFAULT true,collection text NOT NULL,previous_collection text,CONSTRAINT current_index_collection_check CHECK(collection ~ '^campus_docs_[a-f0-9]{64}$'));
  CREATE TABLE campus_docs_serving.index_versions(collection text PRIMARY KEY,docs_embedding_set text,notice_embedding_set text);`);
			await db.query(
				await readFile(
					resolve(
						import.meta.dirname,
						"../../campus-agent-schema/migrations/20261017120000_retrieval_index_binding/migration.sql",
					),
					"utf8",
				),
			);
			// A collection left by the previous publisher stays readable until the first switch.
			const legacy = `campus_docs_${"e".repeat(64)}`;
			await qdrantClient.deleteCollection(legacy);
			await qdrantClient.createCollection({
				collection: legacy,
				denseDistance: "Cosine",
				denseDimensions: EMBEDDING_SPACE.dimensions,
				denseVectorName: "dense",
				sparseVectorName: "sparse",
			});
			await db.query(
				"INSERT INTO campus_docs_serving.current_index(singleton,collection) VALUES(true,$1)",
				[legacy],
			);
			const first = await apply();
			expect(first.collection).toBe(bindingCollection(binding));
			expect(first.retired).toContain(legacy);
			expect(await current()).toEqual({
				collection: first.collection,
				docs_embedding_set: binding.docsEmbeddingSet,
				notice_embedding_set: binding.noticeEmbeddingSet,
			});
			expect(await exists(legacy)).toBe(false);
			// An export pins both points and artifacts against Apply and Cleanup.
			await expect(
				withRetrievalExportLock(reader, async () => {
					await expect(apply()).rejects.toThrow("another retrieval job is running");
					await expect(
						cleanupArtifacts(
							store as ArtifactStore,
							[{ kind: "docs", id: binding.docsEmbeddingSet }],
							env,
						),
					).rejects.toThrow("another retrieval job is running");
					throw new Error("remote download interrupted");
				}),
			).rejects.toThrow("remote download interrupted");
			// Same inputs are idempotent.
			expect(await apply()).toMatchObject({ collection: first.collection, noOp: true });
			const m = JSON.parse(
				Buffer.from(
					await store.read(
						`notices/rag/embedding-sets/sha256/${binding.noticeEmbeddingSet.slice(7)}/manifest.json`,
					),
				).toString(),
			);
			const chunks = Buffer.from(await store.read(m.chunks.key))
				.toString()
				.trim()
				.split("\n")
				.map((x) => JSON.parse(x));
			// Keep retrieval texts/embeddings unchanged; replace one point identity, change another payload.
			chunks[0].chunkId += "-new";
			chunks[1].releasedAt = "2026-10-14T00:00:00Z";
			const bytes = Buffer.from(chunks.map(canonical).join("\n") + "\n"),
				sha = digest(bytes),
				key = `notices/rag/chunk-data/sha256/${sha.slice(7)}/chunks.ndjson`;
			extra.set(key, bytes);
			m.chunks = { key, sha256: sha, byteSize: bytes.length };
			const mb = Buffer.from(canonical(m) + "\n"),
				id = digest(mb);
			extra.set(`notices/rag/embedding-sets/sha256/${id.slice(7)}/manifest.json`, mb);
			// Failure before the switch keeps serving the previous collection.
			await db.query(`CREATE FUNCTION campus_docs_serving.reject_switch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'switch interrupted';END$$;
  CREATE TRIGGER fail_switch BEFORE UPDATE ON campus_docs_serving.current_index FOR EACH ROW EXECUTE FUNCTION campus_docs_serving.reject_switch();`);
			await expect(apply(id)).rejects.toThrow("switch interrupted");
			expect((await current()).collection).toBe(first.collection);
			expect(await exists(first.collection)).toBe(true);
			await db.query("DROP TRIGGER fail_switch ON campus_docs_serving.current_index");
			// During the grace period both collections exist and the pointer already moved.
			const pending = apply(id, 2_000);
			let switched = "";
			for (let i = 0; i < 200 && switched === ""; i++) {
				const now = (await current()).collection;
				if (now !== first.collection) switched = now;
				else await new Promise((r) => setTimeout(r, 25));
			}
			expect(switched).not.toBe("");
			expect(await exists(first.collection)).toBe(true);
			const updated = await pending;
			expect(updated.collection).toBe(switched);
			expect(updated.retired).toEqual([first.collection]);
			expect(await exists(first.collection)).toBe(false);
			const points = (
				await request(`/collections/${updated.collection}/points/scroll`, {
					limit: 100,
					with_payload: true,
				})
			).result.points;
			expect(points).toHaveLength(updated.pointCount);
			expect(points.some((p: any) => p.payload.chunk_id === chunks[0].chunkId)).toBe(true);
			expect(points.some((p: any) => p.payload.chunk_id === chunks[0].chunkId.slice(0, -4))).toBe(
				false,
			);
		} finally {
			const current = (
				await db.query("SELECT collection FROM campus_docs_serving.current_index").catch(() => ({
					rows: [],
				}))
			).rows[0]?.collection;
			if (current) await qdrantClient.deleteCollection(current);
			await reader.end();
			await db.end();
		}
	},
	120000,
);
