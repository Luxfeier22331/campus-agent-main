import { readFile } from "node:fs/promises";

import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { describe, expect, it } from "vitest";

import { writeStoredChunkRun } from "../src/artifacts.ts";
import { buildNoticeChunkRun } from "../src/command.ts";
import {
	collectNoticeEmbeddingInputs,
	noticeEmbeddingCacheKey,
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
	resolveStoredNoticeEmbeddingCache,
} from "../src/embedding-cache.ts";
import {
	buildNoticeEmbeddingSet,
	noticeEmbeddingDataKey,
	noticeEmbeddingSetManifestKey,
	readNoticeEmbeddingSet,
} from "../src/embedding-set.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "../src/encoding.ts";
import { readStoredNoticeChunkRun } from "../src/run-reader.ts";
import type { NoticeArtifactStore } from "../src/types.ts";

describe("cluster notice artifacts", () => {
	it("writes and reads the existing chunk run contract in the derived prefix", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "正文一。", noticeId: "1", title: "通知一" },
				{ contentText: "正文二。", noticeId: "2", title: "通知二" },
			],
		});
		const result = await writeStoredChunkRun({ artifactStore: store, ...prepared });
		const read = await readStoredNoticeChunkRun(store, result.run);

		expect(read.manifest).toMatchObject({
			chunkCount: 2,
			noticeCount: 2,
			schemaVersion: "notice_chunk_run.v1",
		});
		expect([...store.objects.keys()]).toEqual(
			expect.arrayContaining([
				`notices/rag/chunk-runs/sha256/${result.run.slice("sha256:".length)}/manifest.json`,
			]),
		);
	});

	it("builds one embedding for repeated retrieval text and writes an explicit set", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "同一正文。", noticeId: "1", title: "同一通知" },
				{ contentText: "同一正文。", noticeId: "2", title: "同一通知" },
			],
		});
		const chunkRun = await writeStoredChunkRun({ artifactStore: store, ...prepared });
		const requests: string[][] = [];
		const result = await buildNoticeEmbeddingSet({
			artifactStore: store,
			chunkRun: chunkRun.run,
			embedding: {
				async embed(input) {
					requests.push(input.texts);
					return input.texts.map(() => Array(input.dimensions).fill(0.5) as number[]);
				},
			},
			modelTargetSha256: "a".repeat(64),
		});
		const read = await readNoticeEmbeddingSet(store, result.embeddingSet);

		expect(requests).toEqual([["同一通知\n同一正文。"]]);
		expect(result.embeddingCount).toBe(1);
		expect(read.manifest).toMatchObject({
			chunkRun: chunkRun.run,
			embeddingCount: 1,
			modelTargetSha256: "a".repeat(64),
			schemaVersion: "notice_embedding_set.v1",
		});
		expect(store.objects.has(noticeEmbeddingDataKey(read.manifest.embeddings.sha256))).toBe(true);
		expect(store.objects.has(noticeEmbeddingSetManifestKey(result.embeddingSet))).toBe(true);
		expect(result.generatedEmbeddingInputCount).toBe(1);
		expect(result.reusedEmbeddingInputCount).toBe(0);
	});

	it("reuses complete online cache without calling the provider", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "第一段正文。", noticeId: "1", title: "第一条通知" },
				{ contentText: "第二段正文。", noticeId: "2", title: "第二条通知" },
			],
		});
		const chunkRun = await writeStoredChunkRun({ artifactStore: store, ...prepared });
		const modelTargetSha256 = "b".repeat(64);
		for (const textSha256 of collectNoticeEmbeddingInputs(prepared.chunks).keys()) {
			await store.writeImmutable(
				noticeEmbeddingCacheKey(modelTargetSha256, textSha256),
				canonicalJsonBytes({
					dense: vector(),
					embeddingSpace: EMBEDDING_SPACE,
					modelTargetSha256,
					schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
					textSha256,
				}),
			);
		}

		const provider = async () => {
			throw new Error("complete online cache called provider");
		};
		const result = await buildNoticeEmbeddingSet({
			artifactStore: store,
			chunkRun: chunkRun.run,
			embedding: { embed: provider },
			modelTargetSha256,
		});

		expect(result.embeddingCount).toBe(2);
		expect(result.generatedEmbeddingInputCount).toBe(0);
		expect(result.reusedEmbeddingInputCount).toBe(2);
	});

	it("keeps the existing final NDJSON record format and order", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "第一段正文。", noticeId: "1", title: "第一条通知" },
				{ contentText: "第二段正文。", noticeId: "2", title: "第二条通知" },
			],
		});
		const chunkRun = await writeStoredChunkRun({ artifactStore: store, ...prepared });
		const modelTargetSha256 = "d".repeat(64);
		const inputTexts = [...collectNoticeEmbeddingInputs(prepared.chunks)].sort(([left], [right]) =>
			left.localeCompare(right),
		);
		for (const [textSha256] of inputTexts) {
			await store.writeImmutable(
				noticeEmbeddingCacheKey(modelTargetSha256, textSha256),
				canonicalJsonBytes({
					dense: vector(),
					embeddingSpace: EMBEDDING_SPACE,
					modelTargetSha256,
					schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
					textSha256,
				}),
			);
		}
		const result = await buildNoticeEmbeddingSet({
			artifactStore: store,
			chunkRun: chunkRun.run,
			embedding: { embed: async () => { throw new Error("provider should not run"); } },
			modelTargetSha256,
		});
		const manifest = JSON.parse(
			Buffer.from(await store.read(noticeEmbeddingSetManifestKey(result.embeddingSet))).toString("utf8"),
		) as { embeddings: { key: string } };
		const actual = await store.read(manifest.embeddings.key);
		const expected = encodeNdjson(
			inputTexts.map(([retrievalTextSha256]) => ({ dense: vector(), retrievalTextSha256 })),
		);
		expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
	});

	it("keeps completed cache batches when a later provider batch fails", async () => {
		const store = memoryStore();
		const modelTargetSha256 = "c".repeat(64);
		const textBySha256 = new Map(
			Array.from({ length: 9 }, (_, index) => {
				const text = `text-${index}`;
				return [sha256(text), text] as const;
			}),
		);
		await expect(
			resolveStoredNoticeEmbeddingCache({
				artifactStore: store,
				embedding: {
					async embed(input) {
						if (input.texts.length === 1) throw new Error("provider batch failed");
						return input.texts.map(() => vector());
					},
				},
				modelTargetSha256,
				textBySha256,
			}),
		).rejects.toThrow("provider batch failed");
		await new Promise((resolve) => setImmediate(resolve));
		expect(
			[...store.objects.keys()].filter((key) =>
				key.startsWith(`notices/rag/embedding-cache/${modelTargetSha256}/sha256/`),
			),
		).toHaveLength(8);
	});
});

function memoryStore(): NoticeArtifactStore & { objects: Map<string, Uint8Array> } {
	const objects = new Map<string, Uint8Array>();
	const writeImmutable = async (key: string, body: Uint8Array): Promise<void> => {
		const existing = objects.get(key);
		if (existing && !Buffer.from(existing).equals(Buffer.from(body))) {
			throw new Error(`conflicting object: ${key}`);
		}
		objects.set(key, body);
	};
	return {
		objects,
		async read(key) {
			const value = objects.get(key);
			if (!value) throw new Error(`missing object: ${key}`);
			return value;
		},
		async list(prefix) {
			return [...objects.keys()].filter((key) => key.startsWith(prefix));
		},
		writeImmutable,
		async writeImmutableFile(key, input) {
			await writeImmutable(key, await readFile(input.path));
		},
	};
}

function vector(): number[] {
	const dense = new Array<number>(EMBEDDING_SPACE.dimensions).fill(0);
	dense[0] = 1;
	return dense;
}
