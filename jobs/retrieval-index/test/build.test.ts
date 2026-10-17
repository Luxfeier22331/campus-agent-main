import { afterEach, expect, it, vi } from "vitest";
import { CANONICAL_EMBEDDING_MODEL, EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { createProductSeed } from "../../../scripts/dev/product-data/product-data-seed.ts";
import { buildCampusDocsChunkSet } from "../../campus-docs-index-publisher/src/publisher.ts";
import { buildIndex } from "../src/build.ts";
import { prepareCandidate } from "../src/candidate.ts";
import { canonical, digest, workspace } from "../src/workspace.ts";
import type { ArtifactStore } from "../src/stream-store.ts";
import type { Sha256Ref } from "../src/types.ts";

vi.mock("@campus-agent/notice-database", () => ({
	createNoticeDatabasePool: () => ({ end: async () => {} }),
}));
vi.mock("notice-index-publisher/source", () => ({
	async *iteratePublishedNoticeSources() {
		const seed = createProductSeed(new Date("2026-09-18T00:00:00Z"));
		for (const row of seed.rows["notices.notices"].filter(
			(row) => row.is_published && !row.is_external,
		)) {
			yield {
				noticeId: String(row.notice_id),
				title: String(row.title),
				contentText: String(row.content_text),
				releasedAt: new Date(String(row.released_at)).toISOString(),
			};
		}
	},
}));
afterEach(() => vi.unstubAllGlobals());

it("builds reader-compatible Docs/Notice artifacts and reuses vectors without new embedding calls", async () => {
	const seed = createProductSeed(new Date("2026-09-18T00:00:00Z"));
	const objects = new Map([...seed.objects].map(([key, value]) => [key, value.body]));
	const store: ArtifactStore = {
		async read(key) {
			const bytes = objects.get(key);
			if (!bytes) throw new Error(`missing ${key}`);
			return bytes;
		},
		async *stream(key) {
			yield await this.read(key);
		},
		async write(key, bytes) {
			objects.set(key, bytes);
		},
		async writeRecords(prefix, file, rows) {
			const bytes = Buffer.from([...rows()].map(canonical).join("\n") + "\n");
			const sha256 = digest(bytes);
			const key = `${prefix}/sha256/${sha256.slice(7)}/${file}`;
			objects.set(key, bytes);
			return { key, sha256, byteSize: bytes.length };
		},
		async *list(prefix) {
			for (const key of objects.keys()) if (key.startsWith(prefix)) yield key;
		},
		async remove(key) {
			objects.delete(key);
		},
		close() {},
	};
	let embeddingCalls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes("/internal/model-configs/"))
				return Response.json({
					schema_version: "model_runtime_config.v1",
					name: "campus_docs_embedding",
					provider: "openai-compatible",
					api_protocol: "openai.embeddings",
					base_url: "https://embedding.test/v1",
					model: CANONICAL_EMBEDDING_MODEL,
					api_key: "test",
					target_sha256: "a".repeat(64),
				});
			expect(url).toBe("https://embedding.test/v1/embeddings");
			embeddingCalls++;
			const request = JSON.parse(init!.body as string);
			return Response.json({
				data: request.input.map((_: string, index: number) => ({
					index,
					embedding: Array(EMBEDDING_SPACE.dimensions).fill(0.01),
				})),
			});
		}),
	);
	const old = await buildCampusDocsChunkSet({
		sourceStore: store,
		artifactStore: {
			read: store.read,
			async writeImmutable(key, bytes) {
				objects.set(key, bytes);
				return "created" as const;
			},
		},
	});
	const built = (await buildIndex({ store, source: "both" })) as Record<
		string,
		{ embeddingSet: Sha256Ref; generated: number; reused: number }
	>;
	const manifest = JSON.parse(
		Buffer.from(
			await store.read(
				`campus-docs/rag/embedding-sets/sha256/${built.docs!.embeddingSet.slice(7)}/manifest.json`,
			),
		).toString(),
	);
	expect(manifest.chunkSet).toBe(old.chunkSet);
	const work = await workspace();
	try {
		expect(
			(
				await prepareCandidate(
					work.db,
					store,
					built.docs!.embeddingSet,
					built.notices!.embeddingSet,
				)
			).pointCount,
		).toBeGreaterThan(2);
	} finally {
		await work.close();
	}
	expect(embeddingCalls).toBeGreaterThan(0);
	const before = embeddingCalls;
	const reused = (await buildIndex({
		store,
		source: "both",
		reuseDocs: built.docs!.embeddingSet,
		reuseNotices: built.notices!.embeddingSet,
	})) as typeof built;
	expect(embeddingCalls).toBe(before);
	for (const kind of ["docs", "notices"]) {
		expect(reused[kind]!.embeddingSet).toBe(built[kind]!.embeddingSet);
		expect(reused[kind]!.generated).toBe(0);
		expect(reused[kind]!.reused).toBeGreaterThan(0);
	}
});
