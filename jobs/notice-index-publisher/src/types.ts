import type {
	BASELINE_CHUNK_DEFINITION,
	NoticeChunkDefinition,
	NOTICE_CHUNK_RUN_SCHEMA_VERSION,
	NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION,
} from "./definitions.ts";
import { EMBEDDING_SPACE, type EmbeddingClient } from "@campus-agent/embedding-runtime";

export type Sha256Ref = `sha256:${string}`;

export interface NoticeSource {
	contentText: string;
	noticeId: string;
	releasedAt?: string;
	title: string;
}

export interface NoticeChunk {
	chunkId: string;
	chunkIndex: number;
	content: string;
	headingPath: string[];
	noticeId: string;
	releasedAt?: string;
	retrievalText: string;
}

export interface SourceRange {
	end: number;
	start: number;
}

export interface ChunkPart {
	bodyRanges: SourceRange[];
	content: string;
	headingPath: string[];
	joinSeparator?: "\n" | "\n\n";
	kind?:
		| "field"
		| "footer"
		| "list-item"
		| "record"
		| "table-header"
		| "table-row"
		| "text";
	retrievalHeadingPath?: string[];
}

export interface BuiltNoticeChunk extends NoticeChunk {
	bodyRanges: SourceRange[];
	hardSectionId: number;
	parts: ChunkPart[];
}

export interface DetectedHeading {
	level: 1 | 2;
	lineIndex: number;
	range: SourceRange;
	text: string;
}

export interface NoticeChunkStats {
	clauseSplitCount: number;
	hardCutCount: number;
	primaryHeadingCount: number;
	secondaryHeadingCount: number;
	sentenceSplitCount: number;
	tableRowSplitCount: number;
}

export interface BuiltNoticeChunks {
	chunks: BuiltNoticeChunk[];
	definition: NoticeChunkDefinition;
	headings: DetectedHeading[];
	source: NoticeSource;
	stats: NoticeChunkStats;
}

export interface ArtifactReference {
	byteSize: number;
	file: string;
	sha256: Sha256Ref;
}

export interface ObjectReference {
	byteSize: number;
	key: string;
	sha256: Sha256Ref;
}

export interface NoticeArtifactReader {
	read(key: string): Promise<Uint8Array>;
}

export interface NoticeArtifactStore extends NoticeArtifactReader {
	list(prefix: string): Promise<readonly string[]>;
	writeImmutable(key: string, body: Uint8Array): Promise<void>;
	writeImmutableFile(
		key: string,
		input: { byteSize: number; path: string; sha256: Sha256Ref },
	): Promise<void>;
}

export interface NoticeChunkRunManifest {
	chunkCount: number;
	chunks: ArtifactReference;
	definition: NoticeChunkDefinition;
	noticeCount: number;
	reviewSamples: ArtifactReference;
	schemaVersion: typeof NOTICE_CHUNK_RUN_SCHEMA_VERSION | "notice_chunk_run.v1";
	validation: ArtifactReference;
}

export interface DistributionSummary {
	max: number;
	p50: number;
	p75: number;
	p90: number;
	p95: number;
}

export interface BaselineSummary {
	chunkChars: DistributionSummary;
	chunkCount: number;
	definition: typeof BASELINE_CHUNK_DEFINITION;
	primaryBoundaryCrossingCount: number;
}

export interface NoticeChunkValidationReport {
	baseline: BaselineSummary;
	chunkChars: DistributionSummary;
	chunkCount: number;
	clauseSplitCount: number;
	definition: NoticeChunkDefinition;
	fieldValueSplitCount: number;
	footerOnlyChunkCount: number;
	hardCutCount: number;
	headingContentDuplicateCount: number;
	formalHeadingPathViolationCount: number;
	listContinuationSplitCount: number;
	noticeCount: number;
	noticesWithoutDetectedHeadings: number;
	primaryBoundaryCrossingCount: 0;
	primaryHeadingCount: number;
	schemaVersion: typeof NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION;
	secondaryBoundaryCrossingCount: number;
	secondaryHeadingCount: number;
	sentenceSplitCount: number;
	standaloneUrlCount: number;
	tableHeaderContextMissingCount: number;
	tableRowSplitCount: number;
	tinyChunkCount: number;
	orphanLabelCount: number;
	urlOwnerSplitCount: number;
}

export interface NoticeReviewSample {
	chunks: NoticeChunk[];
	contentText: string;
	noticeId: string;
	stratum: ReviewStratum;
	title: string;
}

export type ReviewStratum =
	| "arabic-list"
	| "long-nested"
	| "long-primary"
	| "long-unstructured"
	| "medium"
	| "short";

export interface LocalChunkRunResult {
	chunkCount: number;
	noticeCount: number;
	outputDirectory: string;
	run: Sha256Ref;
}

export interface StoredNoticeChunksResult {
	chunkCount: number;
	noticeCount: number;
	chunks: ObjectReference;
}

export interface StoredNoticeEmbedding {
	dense: number[];
	retrievalTextSha256: Sha256Ref;
}

interface NoticeEmbeddingSetFields {
	embeddingCount: number;
	embeddingSpace: typeof EMBEDDING_SPACE;
	embeddings: ObjectReference;
	modelTargetSha256: string;
}

export type NoticeEmbeddingSetManifest = NoticeEmbeddingSetFields & (
	| { schemaVersion: "notice_embedding_set.v2"; chunks: ObjectReference }
	| { schemaVersion: "notice_embedding_set.v1"; chunkRun: Sha256Ref }
);

export interface NoticeEmbeddingSetData {
	embeddings: StoredNoticeEmbedding[];
	manifest: NoticeEmbeddingSetManifest;
}

export interface BuildNoticeEmbeddingSetInput {
	artifactStore: NoticeArtifactStore;
	chunks: Sha256Ref;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onEmbeddingProgress?: (completedInputCount: number, totalInputCount: number) => void;
}

export interface BuildNoticeEmbeddingSetResult {
	embeddingCount: number;
	embeddingSet: Sha256Ref;
	generatedEmbeddingInputCount: number;
	reusedEmbeddingInputCount: number;
}
