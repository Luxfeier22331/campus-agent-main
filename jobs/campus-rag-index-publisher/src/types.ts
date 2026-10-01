import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";

export type Sha256Ref = `sha256:${string}`;

export type EmbeddingSpace = typeof EMBEDDING_SPACE;

export interface ReaderObjectStore {
	read(key: string): Promise<Uint8Array>;
}

export interface WritableObjectStore extends ReaderObjectStore {
	readIfExists(key: string): Promise<Uint8Array | undefined>;
	writeImmutable(key: string, body: Uint8Array, contentType?: string): Promise<"created" | "existing">;
}

export interface ObjectReference {
	byteSize: number;
	key: string;
	sha256: Sha256Ref;
}

export interface ArtifactReference {
	byteSize: number;
	file: string;
	sha256: Sha256Ref;
}

export interface StoredDocsChunk {
	chunkId: string;
	content: string;
	documentId: string;
	documentTitle: string;
	retrievalText: string;
	retrievalTextSha256: Sha256Ref;
	rootUnitIds: string[];
	sectionId: string;
	sectionRef: string;
	sectionTitle: string;
	versionId: string;
	versionSlug: string;
	isCurrent?: boolean;
	applicableFromAdmissionYear?: number | null;
	applicableToAdmissionYear?: number | null;
	corpus?: string;
}

export interface StoredEmbedding {
	dense: number[];
	retrievalTextSha256: Sha256Ref;
}

export interface DocsChunkSetManifest {
	chunkCount: number;
	chunkDefinition: Record<string, unknown>;
	chunks: ObjectReference;
	documentCount: number;
	readerSchemaVersion: string;
	schemaVersion: "campus_docs_chunk_set.v2";
	sourceProjectionSha256: Sha256Ref;
	sourceSchemaVersion: string;
}

export interface DocsEmbeddingSetManifest {
	chunkSet: Sha256Ref;
	embeddingCount: number;
	embeddingSpace: EmbeddingSpace;
	embeddings: ObjectReference;
	modelTargetSha256: string;
	schemaVersion: "campus_docs_embedding_set.v3";
}

export interface NoticeChunk {
	chunkId: Sha256Ref;
	chunkIndex: number;
	content: string;
	headingPath: string[];
	noticeId: string;
	releasedAt?: string;
	retrievalText: string;
}

export interface NoticeChunkRunManifest {
	chunkCount: number;
	chunks: ArtifactReference;
	definition: Record<string, unknown>;
	noticeCount: number;
	reviewSamples: ArtifactReference;
	schemaVersion: "notice_chunk_run.v2";
	validation: ArtifactReference;
}

export interface NoticeChunkRunData {
	chunks: NoticeChunk[];
	chunksByNoticeId: Map<string, NoticeChunk[]>;
	manifest: NoticeChunkRunManifest;
}

export interface NoticeEmbeddingSetManifest {
	chunkRun: Sha256Ref;
	embeddingCount: number;
	embeddingSpace: EmbeddingSpace;
	embeddings: ObjectReference;
	modelTargetSha256: string;
	schemaVersion: "notice_embedding_set.v1";
}

export interface NoticeEmbeddingSetData {
	embeddings: StoredEmbedding[];
	manifest: NoticeEmbeddingSetManifest;
}

export interface UnifiedPoint {
	id: string;
	payload: Record<string, unknown>;
	vector: {
		dense: number[];
		sparse: { indices: number[]; values: number[] };
	};
}

export type IndexPoint = UnifiedPoint;

export interface QdrantIndexClient {
	collectionExists(collection: string): Promise<boolean>;
	createCollection(input: {
		collection: string;
		denseDistance: string;
		denseDimensions: number;
		denseVectorName: string;
		sparseVectorName: string;
		payloadIndexes?: string[];
	}): Promise<void>;
	deleteCollection(collection: string): Promise<void>;
	upsert(input: {
		collection: string;
		denseVectorName: string;
		points: UnifiedPoint[];
		sparseVectorName: string;
	}): Promise<void>;
	validate(input: {
		collection: string;
		denseDistance: string;
		denseVectorName: string;
		dimensions: number;
		expectedPointCount: number;
		expectedPoints: Iterable<UnifiedPoint> | AsyncIterable<UnifiedPoint>;
		sparseModifier: string;
		sparseVectorName: string;
	}): Promise<void>;
}

export interface CurrentIndexBinding {
	collection: string;
	expectedCurrent?: string | null;
}

export interface IndexVersionInput {
	collection: string;
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
	producer: "manual" | "automatic";
	producerRunId?: string;
}

export interface IndexVersion extends IndexVersionInput {
	validated: boolean;
	createdAt: string;
	activatedAt: string | null;
	retiredAt: string | null;
}


export interface IndexCatalog {
	activate(index: CurrentIndexBinding): Promise<{ noOp: boolean; obsolete?: boolean }>;
	register(index: IndexVersionInput): Promise<{ rebuildIncomplete: boolean }>;
	markValidated(collection: string): Promise<void>;
}

export interface UnifiedPublishInput {
	artifactStore: ReaderObjectStore;
	expectedCurrent?: string | null;
	producer?: "manual" | "automatic";
	producerRunId?: string;
	signal?: AbortSignal;
	catalog: IndexCatalog;
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
	onPublishProgress?: (
		stage: "assemble" | "materialize" | "activate",
	) => void;
	qdrant: QdrantIndexClient;
}

export interface UnifiedPublishResult {
	collection: string;
	obsolete?: boolean;
	noOp: boolean;
	pointCount: number;
}
