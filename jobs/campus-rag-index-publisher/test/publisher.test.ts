import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { compareCanonicalStrings } from "campus-contracts/canonical-order";
import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { describe, expect, it } from "vitest";

import {
	chunkSetManifestKey,
	embeddingSetManifestKey,
	noticeChunkRunPrefix,
	noticeEmbeddingSetManifestKey,
	readDocsEmbeddingSetManifest,
	readNoticeEmbeddingSetManifest,
	readNoticeChunkRun,
} from "../src/artifacts.ts";
import { RETRIEVAL_PAYLOAD_INDEXES } from "../src/definitions.ts";
import {
	assembleCandidate,
	buildNoticePoints,
	materializeCollection,
	publishCampusRagIndex,
} from "../src/publisher.ts";
import type {
	CurrentIndexBinding,
	NoticeChunk,
	ObjectReference,
	QdrantIndexClient,
	ReaderObjectStore,
	Sha256Ref,
	UnifiedPoint,
} from "../src/types.ts";

const DOCS_TEXT = "文档正文";
const NOTICE_TEXT = "通知正文";

describe("unified Campus RAG publisher", () => {
	it("matches the notice payload consumed by Execution Control", () => {
		const fixture = JSON.parse(
			readFileSync(
				new URL("../../../packages/contracts/fixtures/campus_rag/notice-point.v3.json", import.meta.url),
				"utf8",
			),
		) as { chunk: NoticeChunk; point: Pick<UnifiedPoint, "id" | "payload"> };
		const [point] = buildNoticePoints(
			[fixture.chunk],
			[{ dense: vector(3), retrievalTextSha256: sha256(fixture.chunk.retrievalText) }],
		);
		expect({ id: point?.id, payload: point?.payload }).toEqual(fixture.point);
	});

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
			schema_version: "campus_rag_point.v3",
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

	it("publishes v2 without review artifacts and v1 sets with release dates", async () => {
		const modern = await prepareArtifacts({ noticeSchema: "v2" });
		for (const key of modern.store.objects.keys()) {
			if (key.includes("/chunk-runs/")) modern.store.objects.delete(key);
		}
		const candidate = await assembleCandidate(modern.store, modern.docsEmbeddingSet, modern.noticeEmbeddingSet);
		expect(candidate.points[1]?.payload.chunk_id).toBe("notice:42:0");
		const qdrant = fakeQdrant();
		const catalog = fakeCatalog();
		await publishCampusRagIndex({ artifactStore: modern.store, docsEmbeddingSet: modern.docsEmbeddingSet, noticeEmbeddingSet: modern.noticeEmbeddingSet, qdrant, catalog });
		const legacy = await prepareArtifacts();
		const restored = await publishCampusRagIndex({ artifactStore: legacy.store, docsEmbeddingSet: legacy.docsEmbeddingSet, noticeEmbeddingSet: legacy.noticeEmbeddingSet, qdrant, catalog });
		expect(restored.collection).not.toBe(candidate.collection);
		expect(restored.pointCount).toBe(candidate.points.length);
	});

	it.each(["v1", "v2"] as const)("reads %s chunk runs without inventing publication dates", async (chunkRunSchema) => {
		const prepared = await prepareArtifacts({ chunkRunSchema, omitReleasedAt: true });
		const set = await readNoticeEmbeddingSetManifest(prepared.store, prepared.noticeEmbeddingSet);
		if (set.schemaVersion !== "notice_embedding_set.v1") throw new Error("expected v1 set");
		const run = await readNoticeChunkRun(prepared.store, set.chunkRun);
		expect(run.chunks[0]?.releasedAt).toBeUndefined();
		await expect(assembleCandidate(prepared.store, prepared.docsEmbeddingSet, prepared.noticeEmbeddingSet))
			.rejects.toThrow("Notice releasedAt is missing or invalid: 42");
	});

	it("reads serving manifests written with the former English key order", async () => {
		const prepared = await prepareArtifacts();
		const rewrite = (key: string, keyForId: (id: Sha256Ref) => string, pretty: boolean) => {
			const value = JSON.parse(new TextDecoder().decode(prepared.store.objects.get(key)!));
			const order = (entry: unknown): unknown => {
				if (Array.isArray(entry)) return entry.map(order);
				if (!entry || typeof entry !== "object") return entry;
				return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => [k, order(v)]));
			};
			const bytes = new TextEncoder().encode(`${JSON.stringify(order(value), undefined, pretty ? 2 : undefined)}\n`);
			const id = sha256(bytes);
			prepared.store.put(keyForId(id), bytes);
			return id;
		};
		const docs = rewrite(embeddingSetManifestKey(prepared.docsEmbeddingSet), embeddingSetManifestKey, true);
		const notice = rewrite(noticeEmbeddingSetManifestKey(prepared.noticeEmbeddingSet), noticeEmbeddingSetManifestKey, false);
		expect(docs).not.toBe(prepared.docsEmbeddingSet);
		expect(notice).not.toBe(prepared.noticeEmbeddingSet);
		await expect(assembleCandidate(prepared.store, docs, notice)).resolves.toMatchObject({ points: expect.any(Array) });
		const bytes = prepared.store.objects.get(embeddingSetManifestKey(docs))!;
		prepared.store.put(embeddingSetManifestKey(docs), new TextEncoder().encode(new TextDecoder().decode(bytes).replace('"embeddingCount": 1', '"embeddingCount": 2')));
		await expect(assembleCandidate(prepared.store, docs, notice)).rejects.toThrow("digest does not match");
	});

	it("rejects noncanonical manifests even when their digest matches", async () => {
		const prepared = await prepareArtifacts();
		const bytes = prepared.store.objects.get(embeddingSetManifestKey(prepared.docsEmbeddingSet))!;
		const altered = new TextEncoder().encode(` ${new TextDecoder().decode(bytes)}`);
		const id = sha256(altered);
		prepared.store.put(embeddingSetManifestKey(id), altered);
		await expect(assembleCandidate(prepared.store, id, prepared.noticeEmbeddingSet)).rejects.toThrow("not canonical JSON");
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

	it("writes points before creating payload indexes", async () => {
		const prepared = await prepareArtifacts();
		const candidate = await assembleCandidate(
			prepared.store,
			prepared.docsEmbeddingSet,
			prepared.noticeEmbeddingSet,
		);
		const events: string[] = [];
		const qdrant = fakeQdrant();
		qdrant.createCollection = async () => {
			events.push("create");
		};
		qdrant.upsert = async () => {
			events.push("upsert");
		};
		qdrant.createPayloadIndex = async ({ fieldName }) => {
			events.push(`index:${fieldName}`);
		};
		qdrant.validate = async () => {
			events.push("validate");
		};

		await materializeCollection(qdrant, candidate);

		expect(events).toEqual([
			"create",
			"upsert",
			...RETRIEVAL_PAYLOAD_INDEXES.map(({ fieldName }) => `index:${fieldName}`),
			"validate",
		]);
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

    it("registers before rebuilding a partial unvalidated candidate", async () => {
        const prepared = await prepareArtifacts();
        const events: string[] = [];
        let exists = true;
        const catalog = fakeCatalog();
        catalog.register = async () => { events.push("register"); return { rebuildIncomplete: true }; };
        const qdrant = {
            ...fakeQdrant(),
            collectionExists: async () => exists,
            deleteCollection: async () => { events.push("delete"); exists = false; },
            createCollection: async () => { events.push("create"); exists = true; },
            upsert: async () => { events.push("upsert"); },
        };
        await publishCampusRagIndex({ artifactStore: prepared.store, catalog,
            docsEmbeddingSet: prepared.docsEmbeddingSet, noticeEmbeddingSet: prepared.noticeEmbeddingSet, qdrant });
        expect(events.slice(0, 3)).toEqual(["register", "delete", "create"]);
        expect(events).toContain("upsert");
        expect(catalog.activations).toHaveLength(1);
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
			releasedAt: "2026-08-23T10:00:00.000Z",
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
			text: "通知\n办理要求\n正文段落",
		});
	});

	it("publishes local parents and table columns as evidence without changing formal headings", () => {
		const chunk = {
			chunkId: sha256("notice-table-context"), chunkIndex: 1,
			content: "30；毕冉；否；三等奖", headingPath: [], noticeId: "355829",
			releasedAt: "2026-08-23T10:00:00.000Z",
			retrievalText: "获奖名单\n软笔专业组\n表格列：序号；姓名；是否推荐参赛；奖项\n30；毕冉；否；三等奖",
		};
		const point = buildNoticePoints([chunk], [{ dense: vector(3), retrievalTextSha256: sha256(chunk.retrievalText) }])[0]!;
		expect(point.payload.text).toBe(chunk.retrievalText.slice("获奖名单\n".length));
		expect(point.payload.text_sha256).toBe(sha256(String(point.payload.text)));
		expect(point.payload.heading_path).toEqual([]);
		expect(point.payload.title).toBe("获奖名单");
	});

	it("rejects inconsistent titles within one Notice", () => {
		const chunks = [
			{
				chunkId: sha256("notice-chunk-title-1"),
				chunkIndex: 0,
				content: "正文一",
				headingPath: [],
				noticeId: "99",
			releasedAt: "2026-08-23T10:00:00.000Z",
				retrievalText: "通知标题一\n正文一",
			},
			{
				chunkId: sha256("notice-chunk-title-2"),
				chunkIndex: 1,
				content: "正文二",
				headingPath: [],
				noticeId: "99",
			releasedAt: "2026-08-23T10:00:00.000Z",
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
	noticeSchema?: "v1" | "v2";
	chunkRunSchema?: "v1" | "v2";
	omitReleasedAt?: boolean;
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
		chunkId: input.noticeSchema === "v2" ? "notice:42:0" : sha256("notice-chunk-1"),
		chunkIndex: 0,
		content: noticeText,
		headingPath: [],
		noticeId: "42",
		...(input.omitReleasedAt ? {} : { releasedAt: "2026-08-23T10:00:00.000Z" }),
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
		schemaVersion: `notice_chunk_run.${input.chunkRunSchema ?? "v2"}`,
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
		...(input.noticeSchema === "v2" ? { chunks: putObject(store, `notices/rag/chunk-data/sha256/${hex(sha256(noticeChunkBytes))}/chunks.ndjson`, noticeChunkBytes) } : { chunkRun: noticeRun }),
		embeddingCount: 1,
		embeddingSpace: EMBEDDING_SPACE,
		embeddings: noticeEmbeddingRef,
		modelTargetSha256: input.noticeModelTarget ?? "a".repeat(64),
		schemaVersion: input.noticeSchema === "v2" ? "notice_embedding_set.v2" : "notice_embedding_set.v1",
	});
	return { docsChunkKey, docsEmbeddingSet, noticeEmbeddingSet, store };
}

describe("manifest-only embedding set reads", () => {
	it("reads only the manifest object without touching embedding data", async () => {
		const prepared = await prepareArtifacts();
		const docsManifest = await readDocsEmbeddingSetManifest(prepared.store, prepared.docsEmbeddingSet);
		const noticeManifest = await readNoticeEmbeddingSetManifest(
			prepared.store,
			prepared.noticeEmbeddingSet,
		);

		expect(docsManifest.modelTargetSha256).toBe("a".repeat(64));
		expect(noticeManifest.modelTargetSha256).toBe("a".repeat(64));
		expect(noticeManifest.chunkRun).toMatch(/^sha256:/u);
		for (const [key, count] of prepared.store.readCounts) {
			expect(key, `unexpected read of ${key}`).not.toContain("embedding-data");
			expect(count).toBeGreaterThan(0);
		}
	});

	it("still rejects a manifest whose digest does not match its id", async () => {
		const prepared = await prepareArtifacts();
		const key = embeddingSetManifestKey(prepared.docsEmbeddingSet);
		prepared.store.put(key, new TextEncoder().encode('{"tampered":true}\n'));
		await expect(
			readDocsEmbeddingSetManifest(prepared.store, prepared.docsEmbeddingSet),
		).rejects.toThrow("does not match");
	});
});

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
		async createPayloadIndex() {},
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
	register(): Promise<{ rebuildIncomplete: boolean }>;
	markValidated(): Promise<void>;
	activations: CurrentIndexBinding[];
	activate(index: CurrentIndexBinding): Promise<{ noOp: boolean }>;
} {
	const activations: CurrentIndexBinding[] = [];
	return {
		async register() { return { rebuildIncomplete: false }; },
		async markValidated() {},
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
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
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
