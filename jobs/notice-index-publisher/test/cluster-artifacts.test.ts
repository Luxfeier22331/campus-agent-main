import { describe, expect, it } from "vitest";

import { writeStoredChunkRun } from "../src/artifacts.ts";
import { buildNoticeChunkRun } from "../src/command.ts";
import {
	buildNoticeEmbeddingSet,
	noticeEmbeddingDataKey,
	noticeEmbeddingSetManifestKey,
	readNoticeEmbeddingSet,
} from "../src/embedding-set.ts";
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
	});
});

function memoryStore(): NoticeArtifactStore & { objects: Map<string, Uint8Array> } {
	const objects = new Map<string, Uint8Array>();
	return {
		objects,
		async read(key) {
			const value = objects.get(key);
			if (!value) throw new Error(`missing object: ${key}`);
			return value;
		},
		async writeImmutable(key, body) {
			const existing = objects.get(key);
			if (existing && !Buffer.from(existing).equals(Buffer.from(body))) {
				throw new Error(`conflicting object: ${key}`);
			}
			objects.set(key, body);
		},
	};
}
