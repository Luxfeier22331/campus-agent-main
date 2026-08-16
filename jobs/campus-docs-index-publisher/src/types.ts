import type {
	DocsReader,
	DocsReaderElement,
	DocsSourceManifest,
	ObjectRef,
} from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";

export const INDEX_COLLECTION_PREFIX = "campus_docs" as const;
export const CAMPUS_DOCS_SOURCE_KEY = "campus-docs/source.json" as const;

export type Sha256Ref = `sha256:${string}`;

export const INDEX_DEFINITION = {
	chunking: {
		algorithm: "campus_docs_reader_elements.v3",
		maxChars: 1600,
		overlapChars: 0,
		targetChars: 800,
	},
	embedding: {
		distance: "Cosine",
		dimensions: 2560,
		queryInstruction:
			"Given a Campus Web document question, retrieve relevant current passages that answer the query.",
		spaceId: "qwen3-embedding-4b@2560-v1",
		vectorName: "dense",
	},
	pointSchemaVersion: "campus_docs_point.v3",
	readerSchemaVersion: "campus_docs_reader.v3",
	sourceSchemaVersion: "campus_docs_source.v3",
	sparse: {
		language: "none",
		model: "fnv1a_log_tf.v1",
		modifier: "idf",
		provider: "campus-agent",
		tokenizer: "unicode_word_v1",
		vectorName: "sparse",
	},
} as const;

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
	versionLabel: string;
	versionSlug: string;
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
	schema_version: typeof INDEX_DEFINITION.pointSchemaVersion;
	section_ref: string;
	section_title: string;
	text: string;
	text_sha256: `sha256:${string}`;
	version_id: string;
	version_label: string;
	version_slug: string;
}

export interface IndexPoint {
	id: string;
	payload: CampusDocsPointPayload;
	vector: { dense: number[]; sparse: SparseVector };
}

export interface CurrentIndexBinding {
	collection: string;
	dense_vector_name: string;
	embedding_dimensions: number;
	embedding_query_instruction: string;
	embedding_space_id: string;
	sparse_model: string;
	sparse_vector_name: string;
}

export interface SourceVersionSelection {
	document: DocsSourceManifest["documents"][number];
	reader: DocsReader;
	readerRef: ObjectRef;
	version: DocsSourceManifest["versions"][number];
}

export interface EmbeddingClient {
	embed(input: { texts: string[]; dimensions: number }): Promise<number[][]>;
}

export interface EmbeddingProviderSnapshot {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: "openai" | "openai-compatible";
	schemaVersion: "embedding_provider_snapshot.v1";
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
	current(): Promise<CurrentIndexBinding | null>;
}

export interface PublisherIndexCatalog extends IndexCatalog {
	acquirePublisherLock(): Promise<void>;
}

export interface ChunkSetManifest {
	chunkCount: number;
	chunkDefinition: typeof INDEX_DEFINITION.chunking;
	chunks: ObjectRef;
	documentCount: number;
	readerSchemaVersion: typeof INDEX_DEFINITION.readerSchemaVersion;
	schemaVersion: "campus_docs_chunk_set.v1";
	source: ObjectRef;
	sourceProjectionSha256: Sha256Ref;
	sourceSchemaVersion: typeof INDEX_DEFINITION.sourceSchemaVersion;
}

export interface EmbeddingSetManifest {
	chunkSet: Sha256Ref;
	embeddingCount: number;
	embeddingDefinition: typeof INDEX_DEFINITION.embedding;
	embeddings: ObjectRef;
	schemaVersion: "campus_docs_embedding_set.v1";
}

export interface IndexManifest {
	chunkSet: Sha256Ref;
	documentCount: number;
	embeddingSet: Sha256Ref;
	indexDefinition: typeof INDEX_DEFINITION;
	pointCount: number;
	schemaVersion: "campus_docs_index.v1";
	sourceProjectionSha256: Sha256Ref;
}

export interface BuildChunkSetInput {
	store: ArtifactObjectStore;
}

export interface BuildChunkSetResult {
	chunkCount: number;
	chunkSet: Sha256Ref;
	documentCount: number;
	sourceDigest: Sha256Ref;
}

export interface BuildEmbeddingSetInput {
	chunkSet: Sha256Ref;
	embedding: EmbeddingClient;
	reuseEmbeddingSet?: Sha256Ref;
	store: ArtifactObjectStore;
}

export interface BuildEmbeddingSetResult {
	embeddingCount: number;
	embeddingSet: Sha256Ref;
	generatedEmbeddingInputCount: number;
	reusedEmbeddingInputCount: number;
}

export interface PublishIndexInput {
	catalog: IndexCatalog;
	chunkSet: Sha256Ref;
	embeddingSet: Sha256Ref;
	qdrant: QdrantIndexClient;
	store: ArtifactObjectStore;
}

export interface PublishIndexResult {
	collection: string;
	index: Sha256Ref;
	noOp: boolean;
	pointCount: number;
}
