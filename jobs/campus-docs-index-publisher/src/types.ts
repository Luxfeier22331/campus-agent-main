import type {
	DocsReader,
	DocsReaderElement,
	DocsSourceManifest,
	ObjectRef,
} from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";

export const INDEX_COLLECTION_PREFIX = "campus_docs" as const;

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
		model: "Qwen3-Embedding-4B",
		provider: "openai-compatible",
		queryInstruction:
			"Given a Campus Web document question, retrieve relevant current passages that answer the query.",
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
	embedding_model: string;
	embedding_provider: string;
	embedding_query_instruction: string;
	embedding_space_id: string;
	sparse_model: string;
	sparse_vector_name: string;
}

export interface StoredDenseVector {
	dense: number[];
	pointId: string;
	retrievalTextSha256: `sha256:${string}`;
	schemaVersion: string;
}

export interface SourceVersionSelection {
	document: DocsSourceManifest["documents"][number];
	reader: DocsReader;
	readerRef: ObjectRef;
	version: DocsSourceManifest["versions"][number];
}

export interface EmbeddingClient {
	spaceId: string;
	embed(input: { texts: string[]; model: string; dimensions: number }): Promise<number[][]>;
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
	readDenseVectors(input: {
		collection: string;
		denseVectorName: string;
		dimensions: number;
	}): Promise<StoredDenseVector[]>;
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

export interface PublishInput {
	readerStore: ReaderObjectStore;
	sourceBytes: Uint8Array;
	embedding: EmbeddingClient;
	qdrant: QdrantIndexClient;
	catalog: IndexCatalog;
	readSource: () => Promise<Uint8Array>;
}

export interface PublishResult {
	collection: string;
	documentCount: number;
	generatedEmbeddingInputCount?: number;
	noOp: boolean;
	pointCount?: number;
	reusedEmbeddingInputCount?: number;
	sourceDigest: `sha256:${string}`;
	uniqueEmbeddingInputCount?: number;
}
