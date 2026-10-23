import type {
	DocsReader,
	DocsReaderElement,
	DocsSourceManifest,
	ObjectRef,
} from "campus-contracts/campus-docs";
import { EMBEDDING_SPACE, type EmbeddingClient } from "@campus-agent/embedding-runtime";
import type {
	CHUNK_SET_DEFINITION,
	COLLECTION_DEFINITION,
} from "./definitions.ts";

export const INDEX_COLLECTION_PREFIX = "campus_docs" as const;
export type Sha256Ref = `sha256:${string}`;

export interface ReaderObjectStore {
	read(key: string): Promise<Uint8Array>;
}

export interface ArtifactObjectStore extends ReaderObjectStore {
	writeImmutable(key: string, body: Uint8Array): Promise<void>;
}

export interface IndexingSource {
	manifest: DocsSourceManifest;
	sourceBytes: Uint8Array;
	sourceDigest: `sha256:${string}`;
}

export interface ReaderSection {
	anchor: string | null;
	elements: Array<Exclude<DocsReaderElement, { kind: "heading" }>>;
	headingPath: string[];
	sectionId: string;
	sectionTitle: string;
}

export interface IndexChunk {
	chunkId: string;
	content: string;
	documentId: string;
	documentTitle: string;
	retrievalText: string;
	rootUnitIds: string[];
	sectionId: string;
	sectionRef: string;
	sectionTitle: string;
	versionId: string;
	versionSlug: string;
	corpus?: string;
	isCurrent?: boolean;
	applicableFromAdmissionYear?: number | null;
	applicableToAdmissionYear?: number | null;
}

export interface StoredChunk extends IndexChunk {
	retrievalTextSha256: Sha256Ref;
}

export interface StoredEmbedding {
	dense: number[];
	retrievalTextSha256: Sha256Ref;
}

export interface SparseVector {
	indices: number[];
	values: number[];
}

export interface CampusDocsPointPayload {
	chunk_id: string;
	document_id: string;
	document_title: string;
	retrieval_text_sha256: `sha256:${string}`;
	root_unit_ids: string[];
	schema_version: typeof COLLECTION_DEFINITION.pointSchemaVersion;
	section_ref: string;
	section_title: string;
	text: string;
	text_sha256: `sha256:${string}`;
	version_id: string;
	version_slug: string;
	is_current?: boolean;
	applicable_from_admission_year?: number | null;
	applicable_to_admission_year?: number | null;
	corpus?: string;
}

export interface IndexPoint {
	id: string;
	payload: CampusDocsPointPayload;
	vector: { dense: number[]; sparse: SparseVector };
}

export interface CurrentIndexBinding {
	collection: string;
}

export interface SourceVersionSelection {
	document: DocsSourceManifest["documents"][number];
	reader: DocsReader;
	readerRef: ObjectRef;
	version: DocsSourceManifest["versions"][number];
}

export interface QdrantIndexClient {
	collectionExists(collection: string): Promise<boolean>;
	createCollection(input: {
		collection: string;
		denseDistance: string;
		denseDimensions: number;
		denseVectorName: string;
		sparseVectorName: string;
	}): Promise<void>;
	deleteCollection(collection: string): Promise<void>;
	upsert(input: {
		collection: string;
		denseVectorName: string;
		points: IndexPoint[];
		sparseVectorName: string;
	}): Promise<void>;
	validate(input: {
		collection: string;
		denseDistance: string;
		denseVectorName: string;
		expectedPointCount: number;
		dimensions: number;
		expectedPoints: IndexPoint[];
		sparseModifier: string;
		sparseVectorName: string;
	}): Promise<void>;
}

export interface IndexCatalog {
	activate(index: CurrentIndexBinding): Promise<{ noOp: boolean }>;
}

export interface ChunkSetManifest {
	chunkCount: number;
	chunkDefinition: typeof CHUNK_SET_DEFINITION.chunking;
	chunks: ObjectRef;
	documentCount: number;
	readerSchemaVersion: typeof CHUNK_SET_DEFINITION.readerSchemaVersion;
	schemaVersion: "campus_docs_chunk_set.v2";
	sourceProjectionSha256: Sha256Ref;
	sourceSchemaVersion: typeof CHUNK_SET_DEFINITION.sourceSchemaVersion;
}

export interface EmbeddingSetManifest {
	chunkSet: Sha256Ref;
	embeddingCount: number;
	embeddingSpace: typeof EMBEDDING_SPACE;
	embeddings: ObjectRef;
	modelTargetSha256: string;
	schemaVersion: "campus_docs_embedding_set.v3";
}

export interface BuildChunkSetInput {
	artifactStore: ArtifactObjectStore;
	sourceStore: ReaderObjectStore;
}

export interface BuildChunkSetResult {
	chunkCount: number;
	chunkSet: Sha256Ref;
	documentCount: number;
	sourceDigest: Sha256Ref;
	sourceProjectionSha256: Sha256Ref;
}

export interface BuildEmbeddingSetInput {
	artifactStore: ArtifactObjectStore;
	chunkSet: Sha256Ref;
	embedding: EmbeddingClient;
	embeddingTargetSha256: string;
	onEmbeddingProgress?: (completedInputCount: number, totalInputCount: number) => void;
	reuseEmbeddingSet?: Sha256Ref;
}

export interface BuildEmbeddingSetResult {
	embeddingCount: number;
	embeddingSet: Sha256Ref;
	generatedEmbeddingInputCount: number;
	reusedEmbeddingInputCount: number;
}

export interface PublishIndexInput {
	artifactStore: ArtifactObjectStore;
	catalog: IndexCatalog;
	embeddingSet: Sha256Ref;
	onPublishProgress?: (
		stage: "assemble" | "materialize" | "verify-source" | "activate",
	) => void;
	qdrant: QdrantIndexClient;
	sourceStore: ReaderObjectStore;
}

export interface PublishIndexResult {
	collection: string;
	noOp: boolean;
	pointCount: number;
}
