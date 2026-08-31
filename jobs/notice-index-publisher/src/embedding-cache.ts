import { mkdir, readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";

import {
	EMBEDDING_SPACE,
	embedTexts,
	type EmbeddingClient,
} from "@campus-agent/embedding-runtime";

import { writeImmutable } from "./artifacts.ts";
import { canonicalJsonBytes, sha256 } from "./encoding.ts";
import type { Sha256Ref } from "./types.ts";

export const NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION = "notice_embedding_cache.v1" as const;

const CACHE_WRITE_CONCURRENCY = 64;

export interface CachedNoticeEmbedding {
	dense: number[];
	embeddingSpace: typeof EMBEDDING_SPACE;
	modelTargetSha256: string;
	schemaVersion: typeof NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION;
	textSha256: Sha256Ref;
}

export interface ResolvedNoticeEmbeddingVectors {
	generatedInputCount: number;
	generatedTextSha256s: ReadonlySet<Sha256Ref>;
	reusedInputCount: number;
	reusedTextSha256s: ReadonlySet<Sha256Ref>;
	vectorsByTextSha256: Map<Sha256Ref, number[]>;
}

export async function resolveNoticeEmbeddingVectors(input: {
	artifactRoot: string;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onProgress?: (completedInputCount: number, totalInputCount: number) => void;
	textBySha256: ReadonlyMap<Sha256Ref, string>;
}): Promise<ResolvedNoticeEmbeddingVectors> {
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const cacheDirectory = noticeEmbeddingCacheDirectory(input.artifactRoot, input.modelTargetSha256);
	await mkdir(cacheDirectory, { recursive: true });
	const cachedNames = new Set(await readdir(cacheDirectory));
	const vectorsByTextSha256 = new Map<Sha256Ref, number[]>();
	const reusedTextSha256s = new Set<Sha256Ref>();
	const missing: Array<[Sha256Ref, string]> = [];
	const sortedInputs = [...input.textBySha256].sort(([left], [right]) =>
		left.localeCompare(right),
	);
	for (const [textSha256, text] of sortedInputs) {
		if (sha256(text) !== textSha256) {
			throw new Error(`notice embedding input text hash is invalid: ${textSha256}`);
		}
		const fileName = `${artifactHex(textSha256)}.json`;
		if (!cachedNames.has(fileName)) {
			missing.push([textSha256, text]);
			continue;
		}
		const bytes = await readFile(join(cacheDirectory, fileName));
		const cached = parseCachedNoticeEmbedding(bytes, textSha256, input.modelTargetSha256);
		vectorsByTextSha256.set(textSha256, cached.dense);
		reusedTextSha256s.add(textSha256);
	}
	const generatedVectors = await embedTexts(
		input.embedding,
		missing.map(([, text]) => text),
		input.onProgress,
	);
	const writes: Array<{ bytes: Uint8Array; path: string }> = [];
	for (const [index, [textSha256]] of missing.entries()) {
		const dense = generatedVectors[index];
		if (!dense) throw new Error(`embedding result is missing for ${textSha256}`);
		assertValidNoticeEmbeddingVector(dense, textSha256);
		const cached: CachedNoticeEmbedding = {
			dense,
			embeddingSpace: EMBEDDING_SPACE,
			modelTargetSha256: input.modelTargetSha256,
			schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
			textSha256,
		};
		vectorsByTextSha256.set(textSha256, dense);
		writes.push({
			bytes: canonicalJsonBytes(cached),
			path: join(cacheDirectory, `${artifactHex(textSha256)}.json`),
		});
	}
	for (let offset = 0; offset < writes.length; offset += CACHE_WRITE_CONCURRENCY) {
		await Promise.all(
			writes
				.slice(offset, offset + CACHE_WRITE_CONCURRENCY)
				.map((write) => writeImmutable(write.path, write.bytes)),
		);
	}
	if (vectorsByTextSha256.size !== input.textBySha256.size) {
		throw new Error("embedding cache does not cover every notice embedding input");
	}
	return {
		generatedInputCount: missing.length,
		generatedTextSha256s: new Set(missing.map(([textSha256]) => textSha256)),
		reusedInputCount: input.textBySha256.size - missing.length,
		reusedTextSha256s,
		vectorsByTextSha256,
	};
}

export function parseCachedNoticeEmbedding(
	bytes: Uint8Array,
	expectedTextSha256: Sha256Ref,
	expectedModelTargetSha256: string,
): CachedNoticeEmbedding {
	const value = parseJson(bytes, "cached notice embedding");
	if (!isRecord(value) || value.schemaVersion !== NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION) {
		throw new Error("cached notice embedding schema is invalid");
	}
	const cached = value as unknown as CachedNoticeEmbedding;
	if (
		cached.textSha256 !== expectedTextSha256 ||
		cached.modelTargetSha256 !== expectedModelTargetSha256 ||
		!isDeepStrictEqual(cached.embeddingSpace, EMBEDDING_SPACE)
	) {
		throw new Error(`cached notice embedding is invalid: ${expectedTextSha256}`);
	}
	assertValidNoticeEmbeddingVector(cached.dense, expectedTextSha256);
	if (!Buffer.from(canonicalJsonBytes(cached)).equals(Buffer.from(bytes))) {
		throw new Error(`cached notice embedding is not canonical: ${expectedTextSha256}`);
	}
	return cached;
}

export function assertValidNoticeEmbeddingVector(
	value: unknown,
	label = "notice embedding",
): asserts value is number[] {
	if (
		!Array.isArray(value) ||
		value.length !== EMBEDDING_SPACE.dimensions ||
		value.some((item) => typeof item !== "number" || !Number.isFinite(item))
	) {
		throw new Error(`notice embedding vector is invalid: ${label}`);
	}
	const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
	if (!Number.isFinite(norm) || norm === 0) {
		throw new Error(`notice embedding vector norm is invalid: ${label}`);
	}
}

export function noticeEmbeddingCachePath(
	artifactRoot: string,
	modelTargetSha256: string,
	textSha256: Sha256Ref,
): string {
	return join(noticeEmbeddingCacheDirectory(artifactRoot, modelTargetSha256), `${artifactHex(textSha256)}.json`);
}

export function assertNoticeEmbeddingModelTargetSha256(value: string): void {
	if (!/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error("embedding model target must be 64 lowercase hex characters");
	}
}

function noticeEmbeddingCacheDirectory(artifactRoot: string, modelTargetSha256: string): string {
	return join(
		artifactRoot,
		"notices",
		"chunking",
		"embedding-cache",
		modelTargetSha256,
		"sha256",
	);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
