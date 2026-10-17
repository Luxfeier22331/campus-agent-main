import { describe, expect, it, vi } from "vitest";

import type { ReaderObjectStore, WritableObjectStore } from "../src/types.ts";

const publisher = vi.hoisted(() => ({
	readKeys: [] as string[],
}));

vi.mock("../src/publisher.ts", () => ({
	assembleCandidate: async (store: ReaderObjectStore) => {
		for (const key of publisher.readKeys) await store.read(key);
		return { collection: "test", points: [] };
	},
}));

import { importCampusRagArtifacts } from "../src/artifact-import.ts";
import type { Sha256Ref } from "../src/types.ts";

const docsEmbeddingSet = `sha256:${"a".repeat(64)}` as Sha256Ref;
const noticeEmbeddingSet = `sha256:${"b".repeat(64)}` as Sha256Ref;

describe("Campus RAG artifact import", () => {
	it("validates and copies only the recorded RAG artifact closure", async () => {
		publisher.readKeys = [
			"notices/rag/embedding-sets/sha256/b/manifest.json",
			"campus-docs/rag/embedding-data/sha256/a/embeddings.ndjson",
		];
		const source = new MemoryReader({
			"campus-docs/rag/embedding-data/sha256/a/embeddings.ndjson": bytes("docs"),
			"notices/rag/embedding-sets/sha256/b/manifest.json": bytes("notice"),
			"unrelated/source.json": bytes("ignore"),
		});
		const target = new MemoryWriter();

		expect(
			await importCampusRagArtifacts({
				docsEmbeddingSet,
				noticeEmbeddingSet,
				sourceStore: source,
				targetStore: target,
			}),
		).toEqual({
			byteCount: 10,
			createdObjectCount: 2,
			existingObjectCount: 0,
			objectCount: 2,
		});
		expect([...target.objects.keys()]).toEqual([
			"campus-docs/rag/embedding-data/sha256/a/embeddings.ndjson",
			"notices/rag/embedding-sets/sha256/b/manifest.json",
		]);
	});

	it("preflights conflicts before writing any missing object", async () => {
		publisher.readKeys = ["campus-docs/rag/embedding-data/sha256/a/embeddings.ndjson"];
		const target = new MemoryWriter();
		target.objects.set("campus-docs/rag/embedding-data/sha256/a/embeddings.ndjson", bytes("wrong"));
		await expect(
			importCampusRagArtifacts({
				docsEmbeddingSet,
				noticeEmbeddingSet,
				sourceStore: new MemoryReader({
					"campus-docs/rag/embedding-data/sha256/a/embeddings.ndjson": bytes("right"),
				}),
				targetStore: target,
			}),
		).rejects.toThrow("conflicts with existing content");
		expect(target.writeCount).toBe(0);
	});

	it("rejects a validator read outside the allowed RAG namespaces", async () => {
		publisher.readKeys = ["campus-docs/source.json"];
		const target = new MemoryWriter();
		await expect(
			importCampusRagArtifacts({
				docsEmbeddingSet,
				noticeEmbeddingSet,
				sourceStore: new MemoryReader({ "campus-docs/source.json": bytes("bad") }),
				targetStore: target,
			}),
		).rejects.toThrow("outside the RAG namespaces");
		expect(target.writeCount).toBe(0);
	});
});

class MemoryReader implements ReaderObjectStore {
	constructor(private readonly values: Record<string, Uint8Array>) {}

	async read(key: string): Promise<Uint8Array> {
		const value = this.values[key];
		if (!value) throw new Error(`missing source object: ${key}`);
		return value;
	}
}

class MemoryWriter implements WritableObjectStore {
	readonly objects = new Map<string, Uint8Array>();
	writeCount = 0;

	async read(key: string): Promise<Uint8Array> {
		const value = this.objects.get(key);
		if (!value) throw new Error(`missing target object: ${key}`);
		return value;
	}

	async readIfExists(key: string): Promise<Uint8Array | undefined> {
		return this.objects.get(key);
	}

	async writeImmutable(key: string, body: Uint8Array): Promise<"created" | "existing"> {
		this.writeCount += 1;
		const current = this.objects.get(key);
		if (current) {
			if (!sameBytes(current, body)) throw new Error(`conflicts with existing content: ${key}`);
			return "existing";
		}
		this.objects.set(key, new Uint8Array(body));
		return "created";
	}
}

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}
