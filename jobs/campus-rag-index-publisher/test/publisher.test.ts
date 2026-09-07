import { createHash } from "node:crypto";

import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { describe, expect, it } from "vitest";

import {
	chunkSetManifestKey,
	embeddingSetManifestKey,
	noticeChunkRunPrefix,
	noticeEmbeddingSetManifestKey,
} from "../src/artifacts.ts";
import { assembleCandidate, buildNoticePoints, publishCampusRagIndex } from "../src/publisher.ts";
import type {
	CurrentIndexBinding,
	ObjectReference,
	QdrantIndexClient,
	ReaderObjectStore,
	Sha256Ref,
	UnifiedPoint,
} from "../src/types.ts";

const DOCS_TEXT = "文档正文";
const NOTICE_TEXT = "通知正文";

describe("unified Campus RAG publisher", () => {
	it("assembles Docs and Notice points with isolated source namespaces", async () => {
		const prepared = await prepareArtifacts();
		const candidate = await assembleCandidate(
			prepared.store,
			prepared.docsEmbeddingSet,
			prepared.noticeEmbeddingSet,
		);

		expect(candidate.points).toHaveLength(2);
		expect(candidate.points.map((point) => point.payload.source_kind)).toEqual([
			"document",
			"notice",
		]);
		expect(candidate.points[0]?.payload).toMatchObject({
			citation_href: "/docs/guide#intro",
			source_kind: "document",
		});
		expect(candidate.points[1]?.payload).toMatchObject({
			chunk_id: sha256("notice-chunk-1"),
			chunk_index: 0,
			citation_href: "/notices/42",
			heading_path: [],
			notice_id: "42",
			schema_version: "campus_rag_point.v1",
			section_title: "正文",
			source_kind: "notice",
			text: NOTICE_TEXT,
			title: "通知标题",
		});
		expect(candidate.points[1]?.payload.text_sha256).toBe(sha256(NOTICE_TEXT));
		expect(candidate.points[1]?.payload.retrieval_text_sha256).toBe(
			sha256(`通知标题\n${NOTICE_TEXT}`),
		);
		expect(candidate.points[0]?.id).not.toBe(candidate.points[1]?.id);
	});

	it("does not reread immutable artifacts after materialization", async () => {
		const prepared = await prepareArtifacts();
		prepared.store.failAfterReads(prepared.docsChunkKey, 1);
		const qdrant = fakeQdrant();
		const catalog = fakeCatalog();
		const stages: string[] = [];

		await expect(
			publishCampusRagIndex({
				artifactStore: prepared.store,
				catalog,
				docsEmbeddingSet: prepared.docsEmbeddingSet,
				noticeEmbeddingSet: prepared.noticeEmbeddingSet,
				onPublishProgress(stage) {
					stages.push(stage);
				},
				qdrant,
			}),
		).resolves.toMatchObject({ noOp: false, pointCount: 2 });

		expect(catalog.activations).toHaveLength(1);
		expect(qdrant.deletedCollections).toHaveLength(0);
		expect(stages).toEqual(["assemble", "materialize", "activate"]);
	});

	it("does not require review or validation files to assemble serving points", async () => {
		const prepared = await prepareArtifacts();
		for (const key of prepared.store.objects.keys()) {
			if (key.endsWith("/review-samples.ndjson") || key.endsWith("/validation.json")) {
				prepared.store.objects.delete(key);
			}
		}

		await expect(
			assembleCandidate(prepared.store, prepared.docsEmbeddingSet, prepared.noticeEmbeddingSet),
		).resolves.toMatchObject({ points: expect.any(Array) });
	});

	it("rejects model target mismatches before touching Qdrant", async () => {
		const prepared = await prepareArtifacts({ noticeModelTarget: "b".repeat(64) });
		await expect(
			assembleCandidate(prepared.store, prepared.docsEmbeddingSet, prepared.noticeEmbeddingSet),
		).rejects.toThrow("model targets do not match");
	});

	it("rejects missing, extra, and duplicate embedding records", async () => {
		for (const mode of ["missing", "extra", "duplicate"] as const) {
			const prepared = await prepareArtifacts({ docsEmbeddingMode: mode });
			await expect(
				assembleCandidate(prepared.store, prepared.docsEmbeddingSet, prepared.noticeEmbeddingSet),
			).rejects.toThrow(/Docs embedding/);
		}
	});

	it("keeps the pointer unchanged and deletes a newly created bad candidate", async () => {
		const prepared = await prepareArtifacts();
		const qdrant = fakeQdrant({ validationError: new Error("candidate validation failed") });
		const catalog = fakeCatalog();

		await expect(
			publishCampusRagIndex({
				artifactStore: prepared.store,
				catalog,
				docsEmbeddingSet: prepared.docsEmbeddingSet,
				noticeEmbeddingSet: prepared.noticeEmbeddingSet,
				qdrant,
			}),
		).rejects.toThrow("candidate validation failed");

		expect(qdrant.deletedCollections).toHaveLength(1);
		expect(catalog.activations).toHaveLength(0);
	});

	it("does not delete an existing collection that fails validation", async () => {
		const prepared = await prepareArtifacts();
		const qdrant = fakeQdrant({
			existing: true,
			validationError: new Error("existing collection mismatch"),
		});
		const catalog = fakeCatalog();

		await expect(
			publishCampusRagIndex({
				artifactStore: prepared.store,
				catalog,
				docsEmbeddingSet: prepared.docsEmbeddingSet,
				noticeEmbeddingSet: prepared.noticeEmbeddingSet,
				qdrant,
			}),
		).rejects.toThrow("existing collection mismatch");

		expect(qdrant.deletedCollections).toHaveLength(0);
		expect(catalog.activations).toHaveLength(0);
	});

	it("retains a verified candidate when activation fails and supports no-op reruns", async () => {
		const prepared = await prepareArtifacts();
		const failingCatalog = fakeCatalog({ activationError: new Error("activation failed") });
		const qdrant = fakeQdrant();

		await expect(
			publishCampusRagIndex({
				artifactStore: prepared.store,
				catalog: failingCatalog,
				docsEmbeddingSet: prepared.docsEmbeddingSet,
				noticeEmbeddingSet: prepared.noticeEmbeddingSet,
				qdrant,
			}),
		).rejects.toThrow("activation failed");
		expect(qdrant.deletedCollections).toHaveLength(0);

		const noOpCatalog = fakeCatalog({ noOp: true });
		const existingQdrant = fakeQdrant({ existing: true });
		await expect(
			publishCampusRagIndex({
				artifactStore: prepared.store,
				catalog: noOpCatalog,
				docsEmbeddingSet: prepared.docsEmbeddingSet,
				noticeEmbeddingSet: prepared.noticeEmbeddingSet,
				qdrant: existingQdrant,
			}),
		).resolves.toMatchObject({ noOp: true, pointCount: 2 });
	});

	it("changes collection identity when either embedding set changes", async () => {
		const first = await prepareArtifacts();
		const second = await prepareArtifacts({ noticeText: "另一条通知正文" });
		const firstCandidate = await assembleCandidate(
			first.store,
			first.docsEmbeddingSet,
			first.noticeEmbeddingSet,
		);
		const secondCandidate = await assembleCandidate(
			second.store,
			second.docsEmbeddingSet,
			second.noticeEmbeddingSet,
		);
		expect(secondCandidate.collection).not.toBe(firstCandidate.collection);
	});

	it("builds Notice payloads for a chunk with heading metadata", () => {
		const chunk = {
			chunkId: sha256("notice-chunk-heading"),
			chunkIndex: 2,
			content: "正文段落",
			headingPath: ["通知", "办理要求"],
			noticeId: "99",
			retrievalText: "通知标题\n通知\n办理要求\n正文段落",
		};
		const points = buildNoticePoints(
			[chunk],
			[
				{
					dense: vector(3),
					retrievalTextSha256: sha256(chunk.retrievalText),
				},
			],
		);

		expect(points[0]?.payload).toMatchObject({
			chunk_index: 2,
			heading_path: ["通知", "办理要求"],
			section_title: "办理要求",
			text: "正文段落",
		});
	});

	it("rejects inconsistent titles within one Notice", () => {
		const chunks = [
			{
				chunkId: sha256("notice-chunk-title-1"),
				chunkIndex: 0,
				content: "正文一",
				headingPath: [],
				noticeId: "99",
				retrievalText: "通知标题一\n正文一",
			},
			{
				chunkId: sha256("notice-chunk-title-2"),
				chunkIndex: 1,
				content: "正文二",
				headingPath: [],
				noticeId: "99",
				retrievalText: "通知标题二\n正文二",
			},
		];

		expect(() =>
			buildNoticePoints(
				chunks,
				chunks.map((chunk, index) => ({
					dense: vector(index + 4),
					retrievalTextSha256: sha256(chunk.retrievalText),
				})),
			),
		).toThrow("Notice title is inconsistent: 99");
	});
});

interface PreparedArtifacts {
	docsEmbeddingSet: Sha256Ref;
	docsChunkKey: string;
	noticeEmbeddingSet: Sha256Ref;
	store: MemoryStore;
}

async function prepareArtifacts(input: {
	docsEmbeddingMode?: "missing" | "extra" | "duplicate";
	noticeModelTarget?: string;
	noticeText?: string;
} = {}): Promise<PreparedArtifacts> {
	const store = new MemoryStore();
	const docsChunk = {
		chunkId: "doc-chunk-1",
		content: DOCS_TEXT,
		documentId: "guide",
		documentTitle: "使用指南",
		retrievalText: "使用指南\n介绍\n文档正文",
		retrievalTextSha256: sha256("使用指南\n介绍\n文档正文"),
		rootUnitIds: ["root-1"],
		sectionId: "intro",
		sectionRef: "/docs/guide#intro",
		sectionTitle: "介绍",
		versionId: "guide-v1",
		versionSlug: "current",
	};
	const docsChunkBytes = encodeNdjson([docsChunk]);
	const docsChunkKey = `campus-docs/rag/chunk-data/sha256/${hex(sha256(docsChunkBytes))}/chunks.ndjson`;
	const docsChunkRef = putObject(store, docsChunkKey, docsChunkBytes);
	const docsChunkSet = putManifest(store, chunkSetManifestKey, {
		chunkCount: 1,
		chunkDefinition: {
			algorithm: "campus_docs_reader_elements.v5",
			maxChars: 1600,
			overlapChars: 0,
			targetChars: 800,
		},
		chunks: docsChunkRef,
		documentCount: 1,
		readerSchemaVersion: "campus_docs_reader.v3",
		schemaVersion: "campus_docs_chunk_set.v2",
		sourceProjectionSha256: sha256("docs-source"),
		sourceSchemaVersion: "campus_docs_source.v4",
	});
	const docsEmbedding = {
		dense: vector(1),
		retrievalTextSha256: docsChunk.retrievalTextSha256,
	};
	const docsEmbeddingRecords =
		input.docsEmbeddingMode === "missing"
			? []
			: input.docsEmbeddingMode === "extra"
				? [docsEmbedding, { dense: vector(2), retrievalTextSha256: sha256("extra") }]
				: input.docsEmbeddingMode === "duplicate"
					? [docsEmbedding, docsEmbedding]
					: [docsEmbedding];
	const docsEmbeddingBytes = encodeNdjson(docsEmbeddingRecords);
	const docsEmbeddingRef = putObject(store, `campus-docs/rag/embedding-data/sha256/${hex(sha256(docsEmbeddingBytes))}/embeddings.ndjson`, docsEmbeddingBytes);
	const docsEmbeddingSet = putManifest(store, embeddingSetManifestKey, {
		chunkSet: docsChunkSet,
		embeddingCount: docsEmbeddingRecords.length,
		embeddingSpace: EMBEDDING_SPACE,
		embeddings: docsEmbeddingRef,
		modelTargetSha256: "a".repeat(64),
		schemaVersion: "campus_docs_embedding_set.v3",
	});

	const noticeText = input.noticeText ?? NOTICE_TEXT;
	const noticeRetrievalText = `通知标题\n${noticeText}`;
	const noticeChunk = {
		chunkId: sha256("notice-chunk-1"),
		chunkIndex: 0,
		content: noticeText,
		headingPath: [],
		noticeId: "42",
		retrievalText: noticeRetrievalText,
	};
	const noticeChunkBytes = encodeNdjson([noticeChunk]);
	const noticeValidationBytes = canonicalJson({
		chunkCount: 1,
		noticeCount: 1,
		schemaVersion: "notice_chunk_validation.v3",
	});
	const noticeReviewBytes = encodeNdjson([{ noticeId: "42" }]);
	const noticeManifest = {
		chunkCount: 1,
		chunks: reference("chunks.ndjson", noticeChunkBytes),
		definition: {
			algorithm: "notice_text_structure.v8",
			maxChars: 1200,
			overlapChars: 0,
			targetChars: 800,
		},
		noticeCount: 1,
		reviewSamples: reference("review-samples.ndjson", noticeReviewBytes),
		schemaVersion: "notice_chunk_run.v1",
		validation: reference("validation.json", noticeValidationBytes),
	};
	const noticeRunBytes = canonicalJson(noticeManifest);
	const noticeRun = sha256(noticeRunBytes);
	const actualNoticePrefix = noticeChunkRunPrefix(noticeRun);
	for (const [file, bytes] of [
		["chunks.ndjson", noticeChunkBytes],
		["review-samples.ndjson", noticeReviewBytes],
		["validation.json", noticeValidationBytes],
	] as const) {
		store.put(`${actualNoticePrefix}/${file}`, bytes);
	}
	store.put(`${actualNoticePrefix}/manifest.json`, noticeRunBytes);
	const noticeEmbedding = {
		dense: vector(3),
		retrievalTextSha256: sha256(noticeRetrievalText),
	};
	const noticeEmbeddingBytes = encodeNdjson([noticeEmbedding]);
	const noticeEmbeddingRef = putObject(store, `notices/rag/embedding-data/sha256/${hex(sha256(noticeEmbeddingBytes))}/embeddings.ndjson`, noticeEmbeddingBytes);
	const noticeEmbeddingSet = putManifest(store, noticeEmbeddingSetManifestKey, {
		chunkRun: noticeRun,
		embeddingCount: 1,
		embeddingSpace: EMBEDDING_SPACE,
		embeddings: noticeEmbeddingRef,
		modelTargetSha256: input.noticeModelTarget ?? "a".repeat(64),
		schemaVersion: "notice_embedding_set.v1",
	});
	return { docsChunkKey, docsEmbeddingSet, noticeEmbeddingSet, store };
}

class MemoryStore implements ReaderObjectStore {
	readonly objects = new Map<string, Uint8Array>();
	readonly readCounts = new Map<string, number>();
	readonly readLimits = new Map<string, number>();

	async read(key: string): Promise<Uint8Array> {
		const readCount = (this.readCounts.get(key) ?? 0) + 1;
		this.readCounts.set(key, readCount);
		const readLimit = this.readLimits.get(key);
		if (readLimit !== undefined && readCount > readLimit) {
			throw new Error(`simulated read failure: ${key}`);
		}
		const value = this.objects.get(key);
		if (!value) throw new Error(`missing object: ${key}`);
		return value;
	}

	put(key: string, value: Uint8Array): void {
		this.objects.set(key, value);
	}

	failAfterReads(key: string, allowedReads: number): void {
		this.readLimits.set(key, allowedReads);
	}
}

function fakeQdrant(input: {
	existing?: boolean;
	validationError?: Error;
} = {}): QdrantIndexClient & { deletedCollections: string[] } {
	const deletedCollections: string[] = [];
	return {
		deletedCollections,
		async collectionExists() {
			return input.existing ?? false;
		},
		async createCollection() {},
		async deleteCollection(collection) {
			deletedCollections.push(collection);
		},
		async upsert() {},
		async validate() {
			if (input.validationError) throw input.validationError;
		},
	};
}

function fakeCatalog(input: {
	activationError?: Error;
	noOp?: boolean;
} = {}): {
	activations: CurrentIndexBinding[];
	activate(index: CurrentIndexBinding): Promise<{ noOp: boolean }>;
} {
	const activations: CurrentIndexBinding[] = [];
	return {
		activations,
		async activate(index) {
			if (input.activationError) throw input.activationError;
			activations.push(index);
			return { noOp: input.noOp ?? false };
		},
	};
}

function putManifest(
	store: MemoryStore,
	keyForId: (id: Sha256Ref) => string,
	value: Record<string, unknown>,
): Sha256Ref {
	const bytes = canonicalJson(value);
	const id = sha256(bytes);
	store.put(keyForId(id), bytes);
	return id;
}

function putObject(store: MemoryStore, key: string, bytes: Uint8Array): ObjectReference {
	const ref = { byteSize: bytes.byteLength, key, sha256: sha256(bytes) };
	store.put(key, bytes);
	return ref;
}

function reference(file: string, bytes: Uint8Array) {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}

function encodeNdjson(records: readonly unknown[]): Uint8Array {
	return new TextEncoder().encode(`${records.map((record) => JSON.stringify(sortJson(record))).join("\n")}\n`);
}

function canonicalJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value))}\n`);
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, sortJson(child)]),
	);
}

function sha256(value: Uint8Array | string): Sha256Ref {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

function vector(seed: number): number[] {
	const values = new Array<number>(EMBEDDING_SPACE.dimensions).fill(0);
	values[seed] = 1;
	return values;
}
