import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { bindingCollection } from "../src/catalog.ts";
import { cleanupArtifacts } from "../src/cleanup-job.ts";
import type { ArtifactStore } from "../src/stream-store.ts";
import type { Sha256Ref } from "../src/types.ts";
const state = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("pg", () => ({
	Client: class {
		async connect() {}
		async end() {}
		async query(sql: string) {
			return { rows: sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [state.current] };
		}
	},
}));
it("protects current and shared artifacts while retiring explicit Docs and legacy Notice sets", async () => {
	const root = resolve(
		import.meta.dirname,
		"../../../scripts/dev/product-data/fixtures/product-data",
	);
	const binding = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
	state.current = {
		collection: bindingCollection(binding),
		docs_embedding_set: binding.docsEmbeddingSet,
		notice_embedding_set: binding.noticeEmbeddingSet,
	};
	const removed = new Set<string>();
	const files = await readdir(root, { recursive: true });
	const store: ArtifactStore = {
		read: (key) => readFile(resolve(root, key)),
		async *stream(key) {
			yield await this.read(key);
		},
		async *list(prefix) {
			for (const key of files) if (key.startsWith(prefix) && !removed.has(key)) yield key;
		},
		async remove(key) {
			removed.add(key);
		},
		close() {},
		async write() {
			throw new Error("cleanup must not write");
		},
		async writeRecords() {
			throw new Error("cleanup must not write");
		},
	};
	await expect(
		cleanupArtifacts(store, [{ kind: "docs", id: binding.docsEmbeddingSet }]),
	).rejects.toThrow("current artifacts");
	expect(removed.size).toBe(0);
	const targets = files.flatMap((key) => {
		const match = key.match(
			/^(campus-docs|notices)\/rag\/embedding-sets\/sha256\/([a-f0-9]{64})\/manifest.json$/,
		);
		if (!match) return [];
		const kind = match[1] === "campus-docs" ? ("docs" as const) : ("notices" as const);
		const id = `sha256:${match[2]}` as Sha256Ref;
		return id === (kind === "docs" ? binding.docsEmbeddingSet : binding.noticeEmbeddingSet)
			? []
			: [{ kind, id }];
	});
	await cleanupArtifacts(store, targets);
	expect([...removed].some((key) => key.endsWith("review-samples.ndjson"))).toBe(true);
	expect([...removed].some((key) => key.startsWith("campus-docs/rag/chunk-sets/"))).toBe(true);
	for (const [kind, id] of [
		["campus-docs", binding.docsEmbeddingSet],
		["notices", binding.noticeEmbeddingSet],
	]) {
		const key = `${kind}/rag/embedding-sets/sha256/${id.slice(7)}/manifest.json`;
		expect(removed.has(key)).toBe(false);
		const manifest = JSON.parse(Buffer.from(await store.read(key)).toString());
		expect(removed.has(manifest.embeddings.key)).toBe(false);
		if (manifest.chunks) expect(removed.has(manifest.chunks.key)).toBe(false);
		if (manifest.chunkSet) {
			const chunkKey = `campus-docs/rag/chunk-sets/sha256/${manifest.chunkSet.slice(7)}/manifest.json`;
			expect(removed.has(chunkKey)).toBe(false);
			const chunks = JSON.parse(Buffer.from(await store.read(chunkKey)).toString());
			expect(removed.has(chunks.chunks.key)).toBe(false);
		}
	}
	// The previous Worker switched the pointer without updating the artifact references.
	state.current.collection = `campus_docs_${"f".repeat(64)}`;
	await expect(cleanupArtifacts(store, targets)).rejects.toThrow("applied by retrieval-index");
});

for (const phase of ["data", "chunk-manifest", "root"] as const) {
	it(`restarts cleanup after failure in ${phase} deletion without removing retained objects`, async () => {
		const root = resolve(
			import.meta.dirname,
			"../../../scripts/dev/product-data/fixtures/product-data",
		);
		const files = (await readdir(root, { recursive: true })).filter((key) =>
			/\.(json|ndjson)$/.test(key),
		);
		const objects = new Map(
			await Promise.all(
				files.map(async (key) => [key, await readFile(resolve(root, key))] as const),
			),
		);
		const binding = JSON.parse(objects.get("index.json")!.toString());
		state.current = {
			collection: bindingCollection(binding),
			docs_embedding_set: binding.docsEmbeddingSet,
			notice_embedding_set: binding.noticeEmbeddingSet,
		};
		const targets = files.flatMap((key) => {
			const match = key.match(
				/^(campus-docs|notices)\/rag\/embedding-sets\/sha256\/([a-f0-9]{64})\/manifest.json$/,
			);
			if (!match) return [];
			const kind = match[1] === "campus-docs" ? ("docs" as const) : ("notices" as const);
			const id = `sha256:${match[2]}` as Sha256Ref;
			return id === (kind === "docs" ? binding.docsEmbeddingSet : binding.noticeEmbeddingSet)
				? []
				: [{ kind, id }];
		});
		let failed = false;
		const removed: string[] = [];
		const store: ArtifactStore = {
			async read(key) {
				const bytes = objects.get(key);
				if (!bytes) throw Object.assign(new Error(`missing ${key}`), { name: "NoSuchKey" });
				return bytes;
			},
			async *stream(key) {
				yield await this.read(key);
			},
			async *list(prefix) {
				for (const key of objects.keys()) if (key.startsWith(prefix)) yield key;
			},
			async remove(key) {
				const matches =
					phase === "data"
						? !key.endsWith("manifest.json")
						: phase === "root"
							? key.includes("/embedding-sets/")
							: key.endsWith("manifest.json") && !key.includes("/embedding-sets/");
				// Delete first, then simulate a lost response. This exercises already-missing metadata too.
				objects.delete(key);
				removed.push(key);
				if (!failed && matches) {
					failed = true;
					throw new Error("interrupted delete");
				}
			},
			async write() {
				throw new Error("unexpected write");
			},
			async writeRecords() {
				throw new Error("unexpected write");
			},
			close() {},
		};
		await expect(cleanupArtifacts(store, targets)).rejects.toThrow("interrupted delete");
		await cleanupArtifacts(store, targets);
		await cleanupArtifacts(store, targets);
		for (const target of targets)
			expect(
				objects.has(
					`${target.kind === "docs" ? "campus-docs" : "notices"}/rag/embedding-sets/sha256/${target.id.slice(7)}/manifest.json`,
				),
			).toBe(false);
		for (const [kind, id] of [
			["campus-docs", binding.docsEmbeddingSet],
			["notices", binding.noticeEmbeddingSet],
		]) {
			const key = `${kind}/rag/embedding-sets/sha256/${id.slice(7)}/manifest.json`;
			const manifest = JSON.parse((await store.read(key)).toString());
			expect(removed).not.toContain(key);
			expect(objects.has(manifest.embeddings.key)).toBe(true);
			if (manifest.chunks) expect(objects.has(manifest.chunks.key)).toBe(true);
			if (manifest.chunkSet) {
				const c = JSON.parse(
					(
						await store.read(
							`campus-docs/rag/chunk-sets/sha256/${manifest.chunkSet.slice(7)}/manifest.json`,
						)
					).toString(),
				);
				expect(objects.has(c.chunks.key)).toBe(true);
			}
		}
	});
}

function currentBinding(docs: Sha256Ref, notices: Sha256Ref) {
	return {
		collection: bindingCollection({ docsEmbeddingSet: docs, noticeEmbeddingSet: notices }),
		docs_embedding_set: docs,
		notice_embedding_set: notices,
	};
}

it("does not treat denied target reads as completed cleanup", async () => {
	state.current = currentBinding(`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`);
	const remove = vi.fn();
	const store = {
		read: async () => {
			throw Object.assign(new Error("denied"), { name: "AccessDenied" });
		},
		remove,
	} as unknown as ArtifactStore;
	await expect(
		cleanupArtifacts(store, [{ kind: "docs", id: `sha256:${"c".repeat(64)}` }]),
	).rejects.toThrow("denied");
	expect(remove).not.toHaveBeenCalled();
});

it("fails before deletion when a retained manifest is missing", async () => {
	const target = `sha256:${"c".repeat(64)}` as Sha256Ref;
	state.current = currentBinding(`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`);
	const remove = vi.fn();
	const store = {
		async read() {
			throw Object.assign(new Error("retained manifest missing"), { name: "NoSuchKey" });
		},
		async *list(prefix: string) {
			if (prefix.startsWith("campus-docs"))
				yield `campus-docs/rag/embedding-sets/sha256/${"a".repeat(64)}/manifest.json`;
		},
		remove,
	} as unknown as ArtifactStore;
	await expect(cleanupArtifacts(store, [{ kind: "docs", id: target }])).rejects.toThrow(
		"retained manifest missing",
	);
	expect(remove).not.toHaveBeenCalled();
});
