import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { describe, expect, it, vi } from "vitest";

import {
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
	importLocalNoticeEmbeddingCache,
	noticeEmbeddingCacheKey,
	resolveStoredNoticeEmbeddingCache,
} from "../src/embedding-cache.ts";
import { canonicalJsonBytes, sha256 } from "../src/encoding.ts";
import type { NoticeArtifactStore, Sha256Ref } from "../src/types.ts";

const modelTargetSha256 = "a".repeat(64);

describe("stored notice embedding cache", () => {
	it("reuses valid entries and generates only missing inputs", async () => {
		const store = memoryStore();
		const textBySha256 = textMap(["one", "two"]);
		const one = sha256("one");
		await store.writeImmutable(
			noticeEmbeddingCacheKey(modelTargetSha256, one),
			cacheBytes(one),
		);
		const requests: string[][] = [];

		const result = await resolveStoredNoticeEmbeddingCache({
			artifactStore: store,
			embedding: {
				async embed(input) {
					requests.push(input.texts);
					return input.texts.map(() => vector());
				},
			},
			modelTargetSha256,
			textBySha256,
		});

		expect(requests).toEqual([["two"]]);
		expect(result.generatedInputCount).toBe(1);
		expect(result.reusedInputCount).toBe(1);
		expect(store.objects.has(noticeEmbeddingCacheKey(modelTargetSha256, sha256("two")))).toBe(
			true,
		);
	});

	it("rejects corrupt online cache before calling the provider", async () => {
		const store = memoryStore();
		const textSha256 = sha256("one");
		await store.writeImmutable(
			noticeEmbeddingCacheKey(modelTargetSha256, textSha256),
			canonicalJsonBytes({
				dense: new Array<number>(EMBEDDING_SPACE.dimensions).fill(0),
				embeddingSpace: EMBEDDING_SPACE,
				modelTargetSha256,
				schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
				textSha256,
			}),
		);
		const embed = vi.fn(async () => [] as number[][]);

		await expect(
			resolveStoredNoticeEmbeddingCache({
				artifactStore: store,
				embedding: { embed },
				modelTargetSha256,
				textBySha256: textMap(["one"]),
			}),
		).rejects.toThrow("norm is invalid");
		expect(embed).not.toHaveBeenCalled();
	});
});

describe("local notice embedding cache import", () => {
	it("validates every local file before uploading and does not use a provider", async () => {
		const root = await mkdtemp(join(tmpdir(), "notice-embedding-cache-import-"));
		try {
			const cacheDirectory = join(root, "cache");
			await mkdir(cacheDirectory);
			const store = memoryStore();
			const textBySha256 = textMap(["one", "two"]);
			for (const textSha256 of textBySha256.keys()) {
				await writeFile(
					join(cacheDirectory, `${textSha256.slice("sha256:".length)}.json`),
					cacheBytes(textSha256),
				);
			}
			await importLocalNoticeEmbeddingCache({
				artifactStore: store,
				cacheDirectory,
				modelTargetSha256,
				textBySha256,
			});
			expect(store.objects.size).toBe(2);
			expect([...store.objects.keys()].every((key) => key.startsWith("notices/rag/embedding-cache/"))).toBe(
			true,
		);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it.each([
		["missing", "missing"],
		["extra", "extra files"],
		["corrupt", "schema is invalid"],
	] as const)("rejects %s local cache without uploading", async (kind, expectedMessage) => {
		const root = await mkdtemp(join(tmpdir(), `notice-embedding-cache-${kind}-`));
		try {
			const cacheDirectory = join(root, "cache");
			await mkdir(cacheDirectory);
			const store = memoryStore();
			const textBySha256 = textMap(["one", "two"]);
			const one = sha256("one");
			const two = sha256("two");
			await writeFile(join(cacheDirectory, `${one.slice("sha256:".length)}.json`), cacheBytes(one));
			if (kind === "extra") {
				await writeFile(join(cacheDirectory, "extra.json"), cacheBytes(one));
			} else if (kind === "corrupt") {
				await writeFile(
					join(cacheDirectory, `${two.slice("sha256:".length)}.json`),
					new TextEncoder().encode("{}\n"),
				);
			}

			await expect(
				importLocalNoticeEmbeddingCache({
					artifactStore: store,
					cacheDirectory,
					modelTargetSha256,
					textBySha256,
				}),
			).rejects.toThrow(expectedMessage);
			expect(store.objects.size).toBe(0);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});

function textMap(texts: readonly string[]): Map<Sha256Ref, string> {
	return new Map(texts.map((text) => [sha256(text), text] as const));
}

function cacheBytes(textSha256: Sha256Ref): Uint8Array {
	return canonicalJsonBytes({
		dense: vector(),
		embeddingSpace: EMBEDDING_SPACE,
		modelTargetSha256,
		schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
		textSha256,
	});
}

function vector(): number[] {
	const dense = new Array<number>(EMBEDDING_SPACE.dimensions).fill(0);
	dense[0] = 1;
	return dense;
}

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
			const body = objects.get(key);
			if (!body) throw new Error(`missing object: ${key}`);
			return body;
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
