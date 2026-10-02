import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { compareCanonicalStrings } from "campus-contracts/canonical-order";
import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { describe, expect, it, vi } from "vitest";

import { writeLocalChunkRun, writeStoredNoticeChunks } from "../src/artifacts.ts";
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
import { readStoredNoticeChunks } from "../src/run-reader.ts";
import type { NoticeArtifactStore } from "../src/types.ts";

describe("cluster notice artifacts", () => {
	it("decodes embedding records separately without constructing a set-sized string", async () => {
		const store = memoryStore();
		const data = encodeNdjson([
			{retrievalTextSha256: `sha256:${"a".repeat(64)}`, dense:vector()},
			{retrievalTextSha256: `sha256:${"b".repeat(64)}`, dense:vector()},
		]);
		const key = noticeEmbeddingDataKey(sha256(data));
		await store.writeImmutable(key, data);
		const manifest = canonicalJsonBytes({
			schemaVersion:"notice_embedding_set.v1",chunkRun:`sha256:${"c".repeat(64)}`,
			embeddingCount:2,embeddingSpace:EMBEDDING_SPACE,modelTargetSha256:"d".repeat(64),
			embeddings:{key,byteSize:data.byteLength,sha256:sha256(data)},
		});
		const id = sha256(manifest);
		await store.writeImmutable(noticeEmbeddingSetManifestKey(id), manifest);
		const decode = vi.spyOn(TextDecoder.prototype, "decode");
		try {
			expect((await readNoticeEmbeddingSet(store, id)).embeddings).toHaveLength(2);
			expect(decode.mock.calls.every(([input]) => !input || input.byteLength < data.byteLength)).toBe(true);
		} finally { decode.mockRestore(); }
	});
	it("writes only serving chunks and reads them by content digest", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "正文一。", noticeId: "1", title: "通知一" },
				{ contentText: "正文二。", noticeId: "2", title: "通知二" },
			],
		});
		const result = await writeStoredNoticeChunks({ artifactStore: store, ...prepared });
		const read = await readStoredNoticeChunks(store, result.chunks.sha256);
		expect(read.chunks).toEqual(prepared.chunks);
		expect(result).toMatchObject({ chunkCount: 2, noticeCount: 2 });
		expect([...store.objects.keys()]).toEqual([result.chunks.key]);
	});

	it("builds one embedding for repeated retrieval text and writes an explicit set", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "同一正文。", noticeId: "1", title: "同一通知" },
				{ contentText: "同一正文。", noticeId: "2", title: "同一通知" },
			],
		});
		const chunkRun = await writeStoredNoticeChunks({ artifactStore: store, ...prepared });
		const requests: string[][] = [];
		const result = await buildNoticeEmbeddingSet({
			artifactStore: store,
			chunks: chunkRun.chunks.sha256,
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
			chunks: chunkRun.chunks,
			embeddingCount: 1,
			modelTargetSha256: "a".repeat(64),
			schemaVersion: "notice_embedding_set.v2",
		});
		expect(store.objects.has(noticeEmbeddingDataKey(read.manifest.embeddings.sha256))).toBe(true);
		expect(store.objects.has(noticeEmbeddingSetManifestKey(result.embeddingSet))).toBe(true);
		expect(result.generatedEmbeddingInputCount).toBe(1);
		expect(result.reusedEmbeddingInputCount).toBe(0);
	});

	it("keeps serving identity independent of review and algorithm metadata", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-serving-identity-"));
		try {
			const store = memoryStore();
			const prepared = buildNoticeChunkRun({ sources: [{ noticeId: "42", title: "通知", contentText: "原文。" }] });
			const firstRun = await writeLocalChunkRun({ artifactRoot: root, ...prepared });
			const changedReview = { ...prepared, reviewSamples: prepared.reviewSamples.map((sample) => ({ ...sample, reviewOnly: true })), validation: { ...prepared.validation, reviewOnly: true } };
			const secondRun = await writeLocalChunkRun({ artifactRoot: root, ...changedReview });
			expect(firstRun.run).not.toBe(secondRun.run);
			const firstChunks = await writeStoredNoticeChunks({ artifactStore: store, ...prepared });
			const secondChunks = await writeStoredNoticeChunks({ artifactStore: store, ...changedReview });
			expect(firstChunks.chunks).toEqual(secondChunks.chunks);
			const otherDefinition = buildNoticeChunkRun({ sources: [{ noticeId: "42", title: "通知", contentText: "原文。" }], definition: { ...prepared.definition, algorithm: "metadata-only-change" } });
			expect(otherDefinition.chunks).toEqual(prepared.chunks);
			const embed = vi.fn(async (input: { texts: string[] }) => input.texts.map(() => vector()));
			const input = { artifactStore: store, chunks: firstChunks.chunks.sha256, embedding: { embed }, modelTargetSha256: "a".repeat(64) };
			const first = await buildNoticeEmbeddingSet(input);
			const second = await buildNoticeEmbeddingSet({ ...input, chunks: secondChunks.chunks.sha256 });
			expect(first.embeddingSet).toBe(second.embeddingSet);
			expect(embed).toHaveBeenCalledTimes(1);
			expect([...store.objects.keys()].some((key) => key.includes("chunk-runs"))).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("selects new vectors for changed text even when the chunk location stays the same", async () => {
		const store = memoryStore();
		const prepare = (contentText: string) => buildNoticeChunkRun({ sources: [{ noticeId: "42", title: "通知", contentText }] });
		const before = prepare("旧正文。");
		const after = prepare("新正文。");
		expect(before.chunks[0]?.chunkId).toBe("notice:42:0");
		expect(after.chunks[0]?.chunkId).toBe(before.chunks[0]?.chunkId);
		const embed = vi.fn(async (input: { texts: string[] }) => input.texts.map(() => vector()));
		const results = [];
		for (const prepared of [before, after, before]) {
			const chunks = await writeStoredNoticeChunks({ artifactStore: store, ...prepared });
			results.push(await buildNoticeEmbeddingSet({ artifactStore: store, chunks: chunks.chunks.sha256, embedding: { embed }, modelTargetSha256: "a".repeat(64) }));
		}
		expect(results.map((result) => result.generatedEmbeddingInputCount)).toEqual([1, 1, 0]);
		expect(results[0]?.embeddingSet).not.toBe(results[1]?.embeddingSet);
		expect(results[0]?.embeddingSet).toBe(results[2]?.embeddingSet);
		expect(embed.mock.calls.map(([input]) => input.texts)).toEqual([["通知\n旧正文。"], ["通知\n新正文。"]]);
	});

	it("reuses complete online cache without calling the provider", async () => {
		const store = memoryStore();
		const prepared = buildNoticeChunkRun({
			sources: [
				{ contentText: "第一段正文。", noticeId: "1", title: "第一条通知" },
				{ contentText: "第二段正文。", noticeId: "2", title: "第二条通知" },
			],
		});
		const chunkRun = await writeStoredNoticeChunks({ artifactStore: store, ...prepared });
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
			chunks: chunkRun.chunks.sha256,
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
		const chunkRun = await writeStoredNoticeChunks({ artifactStore: store, ...prepared });
		const modelTargetSha256 = "d".repeat(64);
		const inputTexts = [...collectNoticeEmbeddingInputs(prepared.chunks)].sort(([left], [right]) =>
			compareCanonicalStrings(left, right),
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
			chunks: chunkRun.chunks.sha256,
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
