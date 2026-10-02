import { createHash } from "node:crypto";
import { cleanupAutomaticObjects, noticeArtifactKeys } from "notice-index-publisher/cleanup";
import { describe, expect, it } from "vitest";

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
		await expect(noticeArtifactKeys({ read }, embeddingId)).rejects.toThrow(
			"Artifact digest mismatch during cleanup",
		);
	});
});
it("cleanup preserves shared v2 chunks and accepts v1 rollback references", async () => {
	const objects = new Map<string, Uint8Array>();
	const putManifest = (prefix: string, value: unknown) => {
		const bytes = Buffer.from(JSON.stringify(value));
		const id = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
		const key = `notices/rag/${prefix}/sha256/${id.slice(7)}/manifest.json`;
		objects.set(key, bytes);
		return { id, key };
	};
	const shared = `notices/rag/chunk-data/sha256/${"c".repeat(64)}/chunks.ndjson`;
	const data = (id: string) =>
		`notices/rag/embedding-data/sha256/${id.repeat(64)}/embeddings.ndjson`;
	const current = putManifest("embedding-sets", {
		schemaVersion: "notice_embedding_set.v2",
		chunks: { key: shared },
		embeddings: { key: data("a") },
	});
	const retired = putManifest("embedding-sets", {
		schemaVersion: "notice_embedding_set.v2",
		chunks: { key: shared },
		embeddings: { key: data("b") },
	});
	const run = putManifest("chunk-runs", {
		chunks: { file: "chunks.ndjson" },
		validation: { file: "validation.json" },
		reviewSamples: { file: "review-samples.ndjson" },
	});
	const previous = putManifest("embedding-sets", {
		schemaVersion: "notice_embedding_set.v1",
		chunkRun: run.id,
		embeddings: { key: data("d") },
	});
	const store = {
		read: async (key: string) => {
			const bytes = objects.get(key);
			if (!bytes) {
				throw Object.assign(new Error(key), { name: "NoSuchKey" });
			}
			return bytes;
		},
		list: async () => [...objects.keys()],
		inspect: async () => ({ runId: "finished", modifiedAt: new Date(0) }),
		remove: async (key: string) => {
			objects.delete(key);
		},
	};
	const protectedKeys = new Set([
		...(await noticeArtifactKeys(store, current.id)),
		...(await noticeArtifactKeys(store, previous.id)),
	]);
	const retiredKeys = await noticeArtifactKeys(store, retired.id);
	expect(protectedKeys.has(shared)).toBe(true);
	expect(protectedKeys.has(run.key)).toBe(true);
	for (const key of [...protectedKeys, ...retiredKeys]) {
		if (!objects.has(key)) {
			objects.set(key, new Uint8Array([1]));
		}
	}
	await cleanupAutomaticObjects({ store, protectedKeys, retiredKeys, activeRunIds: new Set() });
	expect(objects.has(shared)).toBe(true);
	expect(objects.has(run.key)).toBe(true);
	expect(objects.has(retired.key)).toBe(false);
	expect(objects.has(data("b"))).toBe(false);
	// Retry enumeration needs only the manifest even after data was removed.
	expect(await noticeArtifactKeys(store, retired.id)).toEqual(new Set([retired.key]));
});
