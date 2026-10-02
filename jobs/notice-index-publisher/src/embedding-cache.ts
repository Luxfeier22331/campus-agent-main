import { ArtifactValidationError } from "@campus-agent/embedding-runtime";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";

import { compareCanonicalStrings } from "campus-contracts/canonical-order";

import {
	EMBEDDING_SPACE,
	embedTextBatches,
	type EmbeddingClient,
} from "@campus-agent/embedding-runtime";

import { writeImmutable } from "./artifacts.ts";
import { canonicalJsonBytes, sha256 } from "./encoding.ts";
import type { NoticeArtifactStore, NoticeChunk, Sha256Ref } from "./types.ts";

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

export interface ResolvedStoredNoticeEmbeddingCache {
	generatedInputCount: number;
	generatedTextSha256s: ReadonlySet<Sha256Ref>;
	reusedInputCount: number;
	reusedTextSha256s: ReadonlySet<Sha256Ref>;
	vectorsByTextSha256: ReadonlyMap<Sha256Ref, number[]>;
}

export interface ImportedNoticeEmbeddingCache {
	importedEmbeddingInputCount: number;
	modelTargetSha256: string;
	textCount: number;
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
	const sortedInputs = sortNoticeEmbeddingInputs(input.textBySha256);
	for (const [textSha256, text] of sortedInputs) {
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
	await embedTextBatches(
		input.embedding,
		missing.map(([, text]) => text),
		async (batch) => {
			await Promise.all(
				batch.vectors.map(async (dense, index) => {
					const entry = missing[batch.offset + index];
					if (!entry) throw new ArtifactValidationError("embedding result batch offset is invalid");
					const [textSha256] = entry;
					// 向量维度与数值已由 embedding-runtime 的 embedTextBatches 在 provider
					// 返回边界校验，此处不再重复。
					vectorsByTextSha256.set(textSha256, dense);
					await writeImmutable(
						noticeEmbeddingCachePath(
							input.artifactRoot,
							input.modelTargetSha256,
							textSha256,
						),
						canonicalJsonBytes(
							cachedNoticeEmbedding(dense, textSha256, input.modelTargetSha256),
						),
					);
				}),
			);
		},
		input.onProgress,
	);
	if (vectorsByTextSha256.size !== input.textBySha256.size) {
		throw new ArtifactValidationError("embedding cache does not cover every notice embedding input");
	}
	return {
		generatedInputCount: missing.length,
		generatedTextSha256s: new Set(missing.map(([textSha256]) => textSha256)),
		reusedInputCount: input.textBySha256.size - missing.length,
		reusedTextSha256s,
		vectorsByTextSha256,
	};
}

export async function resolveStoredNoticeEmbeddingCache(input: {
	artifactStore: NoticeArtifactStore;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onProgress?: (completedInputCount: number, totalInputCount: number) => void;
	textBySha256: ReadonlyMap<Sha256Ref, string>;
}): Promise<ResolvedStoredNoticeEmbeddingCache> {
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const sortedInputs = sortNoticeEmbeddingInputs(input.textBySha256);
	const storedKeys = new Set(
		await input.artifactStore.list(noticeEmbeddingCachePrefix(input.modelTargetSha256)),
	);
	const missing: Array<[Sha256Ref, string]> = [];
	const reusedTextSha256s = new Set<Sha256Ref>();
	const vectorsByTextSha256 = new Map<Sha256Ref, number[]>();
	for (const [textSha256, text] of sortedInputs) {
		const key = noticeEmbeddingCacheKey(input.modelTargetSha256, textSha256);
		if (!storedKeys.has(key)) {
			missing.push([textSha256, text]);
			continue;
		}
		const cached = parseCachedNoticeEmbedding(
			await input.artifactStore.read(key),
			textSha256,
			input.modelTargetSha256,
		);
		vectorsByTextSha256.set(textSha256, cached.dense);
		reusedTextSha256s.add(textSha256);
	}

	const generatedTextSha256s = new Set<Sha256Ref>();
	await embedTextBatches(
		input.embedding,
		missing.map(([, text]) => text),
		async (batch) => {
			await Promise.all(
				batch.vectors.map(async (dense, index) => {
					const entry = missing[batch.offset + index];
					if (!entry) throw new ArtifactValidationError("embedding result batch offset is invalid");
					const [textSha256] = entry;
					const bytes = canonicalJsonBytes(
						cachedNoticeEmbedding(dense, textSha256, input.modelTargetSha256),
					);
					await input.artifactStore.writeImmutable(
						noticeEmbeddingCacheKey(input.modelTargetSha256, textSha256),
						bytes,
					);
					vectorsByTextSha256.set(textSha256, dense);
					generatedTextSha256s.add(textSha256);
				}),
			);
		},
		input.onProgress,
	);
	return {
		generatedInputCount: generatedTextSha256s.size,
		generatedTextSha256s,
		reusedInputCount: reusedTextSha256s.size,
		reusedTextSha256s,
		vectorsByTextSha256,
	};
}

export async function importLocalNoticeEmbeddingCache(input: {
	artifactStore: NoticeArtifactStore;
	cacheDirectory: string;
	modelTargetSha256: string;
	textBySha256: ReadonlyMap<Sha256Ref, string>;
}): Promise<ImportedNoticeEmbeddingCache> {
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const sortedInputs = sortNoticeEmbeddingInputs(input.textBySha256);
	const names = new Set(await readdir(input.cacheDirectory));
	const expectedNames = new Set(sortedInputs.map(([textSha256]) => cacheFileName(textSha256)));
	const extraNames = [...names].filter((name) => !expectedNames.has(name)).sort();
	if (extraNames.length > 0) {
		throw new ArtifactValidationError(`notice embedding cache contains extra files: ${extraNames[0]}`);
	}
	const missingNames = [...expectedNames].filter((name) => !names.has(name)).sort();
	if (missingNames.length > 0) {
		throw new ArtifactValidationError(`notice embedding cache is missing files: ${missingNames[0]}`);
	}

	for (const [textSha256] of sortedInputs) {
		parseCachedNoticeEmbedding(
			await readFile(join(input.cacheDirectory, cacheFileName(textSha256))),
			textSha256,
			input.modelTargetSha256,
		);
	}

	for (let offset = 0; offset < sortedInputs.length; offset += CACHE_WRITE_CONCURRENCY) {
		await Promise.all(
			sortedInputs.slice(offset, offset + CACHE_WRITE_CONCURRENCY).map(async ([textSha256]) => {
				await input.artifactStore.writeImmutable(
					noticeEmbeddingCacheKey(input.modelTargetSha256, textSha256),
					await readFile(join(input.cacheDirectory, cacheFileName(textSha256))),
				);
			}),
		);
	}
	return {
		importedEmbeddingInputCount: sortedInputs.length,
		modelTargetSha256: input.modelTargetSha256,
		textCount: sortedInputs.length,
	};
}

export function collectNoticeEmbeddingInputs(
	chunks: readonly NoticeChunk[],
): Map<Sha256Ref, string> {
	const inputs = createNoticeEmbeddingInputs();
	for (const chunk of chunks) inputs.add(chunk.retrievalText);
	return inputs.textBySha256;
}

// One collector owns text identity for each embedding operation.
export function createNoticeEmbeddingInputs() {
	const sha256ByText = new Map<string, Sha256Ref>();
	const textBySha256 = new Map<Sha256Ref, string>();
	return {
		textBySha256,
		add(text: string): Sha256Ref {
			const existing = sha256ByText.get(text);
			if (existing) return existing;
			const digest = sha256(text);
			if (textBySha256.has(digest) && textBySha256.get(digest) !== text) {
				throw new ArtifactValidationError(`notice embedding text digest collision: ${digest}`);
			}
			sha256ByText.set(text, digest);
			textBySha256.set(digest, text);
			return digest;
		},
	};
}

export function sortNoticeEmbeddingInputs(
	textBySha256: ReadonlyMap<Sha256Ref, string>,
): Array<[Sha256Ref, string]> {
	return [...textBySha256].sort(([left], [right]) => compareCanonicalStrings(left, right));
}

export function noticeEmbeddingCachePrefix(modelTargetSha256: string): string {
	assertNoticeEmbeddingModelTargetSha256(modelTargetSha256);
	return `notices/rag/embedding-cache/${modelTargetSha256}/sha256`;
}

export function noticeEmbeddingCacheKey(
	modelTargetSha256: string,
	textSha256: Sha256Ref,
): string {
	assertTextSha256(textSha256);
	return `${noticeEmbeddingCachePrefix(modelTargetSha256)}/${artifactHex(textSha256)}.json`;
}

export function parseCachedNoticeEmbedding(
	bytes: Uint8Array,
	expectedTextSha256: Sha256Ref,
	expectedModelTargetSha256: string,
): CachedNoticeEmbedding {
	const value = parseJson(bytes, "cached notice embedding");
	if (!isRecord(value) || value.schemaVersion !== NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION) {
		throw new ArtifactValidationError("cached notice embedding schema is invalid");
	}
	const cached = value as unknown as CachedNoticeEmbedding;
	if (
		cached.textSha256 !== expectedTextSha256 ||
		cached.modelTargetSha256 !== expectedModelTargetSha256 ||
		!isDeepStrictEqual(cached.embeddingSpace, EMBEDDING_SPACE)
	) {
		throw new ArtifactValidationError(`cached notice embedding is invalid: ${expectedTextSha256}`);
	}
	assertValidNoticeEmbeddingVector(cached.dense, expectedTextSha256);
	if (!Buffer.from(canonicalJsonBytes(cached)).equals(Buffer.from(bytes))) {
		throw new ArtifactValidationError(`cached notice embedding is not canonical: ${expectedTextSha256}`);
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
		throw new ArtifactValidationError(`notice embedding vector is invalid: ${label}`);
	}
	const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
	if (!Number.isFinite(norm) || norm === 0) {
		throw new ArtifactValidationError(`notice embedding vector norm is invalid: ${label}`);
	}
}

export function noticeEmbeddingCachePath(
	artifactRoot: string,
	modelTargetSha256: string,
	textSha256: Sha256Ref,
): string {
	assertNoticeEmbeddingModelTargetSha256(modelTargetSha256);
	assertTextSha256(textSha256);
	return join(
		noticeEmbeddingCacheDirectory(artifactRoot, modelTargetSha256),
		`${artifactHex(textSha256)}.json`,
	);
}

export function assertNoticeEmbeddingModelTargetSha256(value: string): void {
	if (!/^[0-9a-f]{64}$/u.test(value)) {
		throw new ArtifactValidationError("embedding model target must be 64 lowercase hex characters");
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

function cachedNoticeEmbedding(
	dense: number[],
	textSha256: Sha256Ref,
	modelTargetSha256: string,
): CachedNoticeEmbedding {
	return {
		dense,
		embeddingSpace: EMBEDDING_SPACE,
		modelTargetSha256,
		schemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
		textSha256,
	};
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new ArtifactValidationError(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

function cacheFileName(value: Sha256Ref): string {
	assertTextSha256(value);
	return `${artifactHex(value)}.json`;
}

function assertTextSha256(value: Sha256Ref): void {
	if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
		throw new ArtifactValidationError("notice embedding text SHA-256 is invalid");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
