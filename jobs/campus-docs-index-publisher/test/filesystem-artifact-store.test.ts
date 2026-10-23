import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs/fixture";
import { DOCS_SOURCE_KEY } from "campus-contracts/campus-docs";
import { chunkSetManifestKey, readChunkSet } from "../src/artifacts.ts";
import { createFilesystemArtifactStore } from "../src/filesystem-artifact-store.ts";
import { buildCampusDocsChunkSet } from "../src/publisher.ts";
import {
	type ArtifactObjectStore,
	type ReaderObjectStore,
} from "../src/types.ts";

describe("filesystem artifact store", () => {
	it("creates immutable artifacts and accepts an identical rerun", async () => {
		const root = await mkdtemp(join(tmpdir(), "campus-docs-artifacts-"));
		try {
			const store = createFilesystemArtifactStore(root);
			const key = "campus-docs/rag/chunk-data/sha256/test/chunks.ndjson";
			const body = new TextEncoder().encode("{\"chunk\":1}\n");

			await store.writeImmutable(key, body);
			await store.writeImmutable(key, body);

			expect(await store.read(key)).toEqual(body);
			expect(await readFile(join(root, key))).toEqual(Buffer.from(body));
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it("rejects conflicting content at an existing key", async () => {
		const root = await mkdtemp(join(tmpdir(), "campus-docs-artifacts-"));
		try {
			const store = createFilesystemArtifactStore(root);
			const key = "campus-docs/rag/chunk-sets/sha256/test/manifest.json";
			await store.writeImmutable(key, new TextEncoder().encode("{}\n"));

			await expect(
				store.writeImmutable(key, new TextEncoder().encode("{\"changed\":true}\n")),
			).rejects.toThrow(`immutable artifact conflicts with existing content: ${key}`);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it("produces the same chunk set bytes as an in-memory artifact store", async () => {
		const root = await mkdtemp(join(tmpdir(), "campus-docs-artifacts-"));
		try {
			const fixture = createDocsSourceSiteFixture();
			const sourceStore: ReaderObjectStore = {
				async read(key) {
					const body = key === DOCS_SOURCE_KEY
						? fixture.sourceBytes
						: fixture.objects.get(key)?.body;
					if (!body) throw new Error(`missing fixture object: ${key}`);
					return body;
				},
			};
			const memoryStore = new MemoryArtifactStore();
			const filesystemStore = createFilesystemArtifactStore(root);
			const memoryResult = await buildCampusDocsChunkSet({
				artifactStore: memoryStore,
				sourceStore,
			});
			const filesystemResult = await buildCampusDocsChunkSet({
				artifactStore: filesystemStore,
				sourceStore,
			});

			expect(filesystemResult).toEqual(memoryResult);
			const manifestKey = chunkSetManifestKey(memoryResult.chunkSet);
			expect(await filesystemStore.read(manifestKey)).toEqual(await memoryStore.read(manifestKey));
			const loaded = await readChunkSet(memoryStore, memoryResult.chunkSet);
			expect(await filesystemStore.read(loaded.manifest.chunks.key)).toEqual(
				await memoryStore.read(loaded.manifest.chunks.key),
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});

class MemoryArtifactStore implements ArtifactObjectStore {
	readonly objects = new Map<string, Uint8Array>();

	async read(key: string): Promise<Uint8Array> {
		const body = this.objects.get(key);
		if (!body) throw new Error(`missing artifact: ${key}`);
		return body;
	}

	async writeImmutable(key: string, body: Uint8Array): Promise<void> {
		const existing = this.objects.get(key);
		if (existing && !Buffer.from(existing).equals(Buffer.from(body))) {
			throw new Error(`immutable artifact conflict: ${key}`);
		}
		this.objects.set(key, body);
	}
}
