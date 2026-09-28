import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanupAutomaticObjects, noticeArtifactKeys } from "../src/cleanup.ts";

describe("automatic artifact cleanup", () => {
	it("preserves current, previous, shared, manual, active and recent orphan objects", async () => {
		const prefix = "notices/rag/";
		const keys = [
			"current",
			"previous",
			"shared",
			"manual",
			"active",
			"recent",
			"retired",
			"orphan",
			"embedding-cache/cached",
		].map((key) => prefix + key);
		const removed: string[] = [];
		const now = Date.now();
		const count = await cleanupAutomaticObjects({
			now,
			protectedKeys: new Set(keys.slice(0, 3)),
			retiredKeys: new Set([`${prefix}retired`]),
			activeRunIds: new Set(["active"]),
			store: {
				read: async () => new Uint8Array(),
				list: async () => keys,
				inspect: async (key) => ({
					runId: key.endsWith("manual") ? null : key.endsWith("active") ? "active" : "finished",
					modifiedAt: new Date(now - (key.endsWith("orphan") ? 25 : 2) * 3600000),
				}),
				remove: async (key) => {
					removed.push(key);
				},
			},
		});
		expect(count).toBe(2);
		expect(removed).toEqual([`${prefix}retired`, `${prefix}orphan`]);
	});
	it("deletes data before manifests and propagates failures for a later retry", async () => {
		const keys = [
			"notices/rag/embedding-sets/x/manifest.json",
			"notices/rag/chunk-runs/x/manifest.json",
			"notices/rag/data",
		];
		const removed: string[] = [];
		await expect(
			cleanupAutomaticObjects({
				protectedKeys: new Set(),
				retiredKeys: new Set(keys),
				activeRunIds: new Set(),
				store: {
					read: async () => new Uint8Array(),
					list: async () => keys,
					inspect: async () => ({ runId: "finished", modifiedAt: new Date(0) }),
					remove: async (key) => {
						removed.push(key);
						if (removed.length === 2) {
							throw new Error("storage unavailable");
						}
					},
				},
			}),
		).rejects.toThrow("storage unavailable");
		expect(removed).toEqual([keys[2], keys[1]]);
	});
	it("retries only remaining objects after partial deletion", async () => {
		const data = "notices/rag/embedding-data/data";
		const manifest = "notices/rag/embedding-sets/x/manifest.json";
		const remaining = new Set([manifest, data]);
		let fail = true;
		const deleted: string[] = [];
		const input = {
			protectedKeys: new Set<string>(),
			retiredKeys: new Set(remaining),
			activeRunIds: new Set<string>(),
			store: {
				read: async () => new Uint8Array(),
				list: async () => [...remaining],
				inspect: async () => ({ runId: "finished", modifiedAt: new Date(0) }),
				remove: async (key: string) => {
					if (key === manifest && fail) {
						fail = false;
						throw new Error("storage unavailable");
					}
					remaining.delete(key);
					deleted.push(key);
				},
			},
		};
		await expect(cleanupAutomaticObjects(input)).rejects.toThrow("storage unavailable");
		expect(await cleanupAutomaticObjects(input)).toBe(1);
		expect(deleted).toEqual([data, manifest]);
		expect(remaining.size).toBe(0);
	});
});

describe("protected artifact references", () => {
	it("protects legacy manifest bytes by digest without loading all vectors", async () => {
		const objects = new Map<string, Uint8Array>();
		const encode = (value: unknown) =>
			new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
		const ref = (bytes: Uint8Array) =>
			`sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
		const chunk = encode({
			reviewSamples: { file: "review-samples.ndjson" },
			validation: { file: "validation.json" },
			chunks: { file: "chunks.ndjson" },
		});
		const chunkId = ref(chunk);
		const dataKey = `notices/rag/embedding-data/sha256/${"a".repeat(64)}/embeddings.ndjson`;
		const embedding = encode({
			embeddings: { key: dataKey },
			chunkRun: chunkId,
			embeddingSpace: { dimensions: 1024 },
		});
		const embeddingId = ref(embedding);
		objects.set(
			`notices/rag/embedding-sets/sha256/${embeddingId.slice(7)}/manifest.json`,
			embedding,
		);
		objects.set(`notices/rag/chunk-runs/sha256/${chunkId.slice(7)}/manifest.json`, chunk);
		const read = async (key: string) => {
			const value = objects.get(key);
			if (!value) {
				throw new Error("must only read manifests");
			}
			return value;
		};
		const protectedKeys = await noticeArtifactKeys({ read }, embeddingId);
		expect(protectedKeys.size).toBe(6);
		expect(protectedKeys.has(dataKey)).toBe(true);
		objects.set(
			`notices/rag/embedding-sets/sha256/${embeddingId.slice(7)}/manifest.json`,
			encode({ tampered: true }),
		);
		await expect(noticeArtifactKeys({ read }, embeddingId)).rejects.toThrow("digest mismatch");
	});
});
