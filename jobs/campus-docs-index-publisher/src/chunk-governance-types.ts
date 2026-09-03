import type {
	CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_COMPARISON_RUN_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_EMBEDDING_CACHE_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_EMBEDDING_EVALUATION_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_EMBEDDING_METRICS_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION,
} from "./chunk-governance-definitions.ts";
import type { ObjectRef } from "campus-contracts/campus-docs";
import type { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import type { CHUNK_SET_DEFINITION } from "./definitions.ts";
import type { Sha256Ref, StoredChunk } from "./types.ts";

export interface CampusDocsGovernanceChunkDefinition {
	algorithm: string;
	maxChars: number;
	overlapChars: number;
	targetChars: number;
}

export interface CampusDocsGovernanceChunkSetManifest {
	chunkCount: number;
	chunkDefinition: CampusDocsGovernanceChunkDefinition;
	chunks: ObjectRef;
	documentCount: number;
	readerSchemaVersion: string;
	schemaVersion: "campus_docs_chunk_set.v2";
	sourceProjectionSha256: Sha256Ref;
	sourceSchemaVersion: string;
}

export interface CampusDocsGovernanceChunkSetData {
	chunks: StoredChunk[];
	id: Sha256Ref;
	manifest: CampusDocsGovernanceChunkSetManifest;
}

export interface GovernanceArtifactReference {
	byteSize: number;
	file: string;
	sha256: Sha256Ref;
}

export interface NumericDistribution {
	max: number;
	mean: number;
	min: number;
	p10: number;
	p25: number;
	p50: number;
	p75: number;
	p90: number;
	p95: number;
	p99: number;
}

export interface CampusDocsDocumentCensus {
	blockquoteCount: number;
	chunkCount: number;
	collection: string;
	documentId: string;
	documentTitle: string;
	headingCount: number;
	maxHeadingLevel: number;
	paragraphCount: number;
	readerElementCount: number;
	repeatedRootUnitCount: number;
	sectionCount: number;
	shortChunkCount: number;
	tableCount: number;
	tinyChunkCount: number;
	totalChars: number;
	corpus: string;
	listCount: number;
	nearMaxChunkCount: number;
	sameSectionBoundaryCount: number;
	supplementCount: number;
}

export interface CampusDocsSectionCensus {
	chunkCount: number;
	documentId: string;
	headingPath: string[];
	maxChunkChars: number;
	minChunkChars: number;
	sectionId: string;
	sectionTitle: string;
	shortChunkCount: number;
	totalChars: number;
	tinyChunkCount: number;
}

export interface CampusDocsDimensionCensus {
	chunkCount: number;
	documentCount: number;
	shortChunkCount: number;
	tinyChunkCount: number;
	totalChars: number;
}

export interface CampusDocsChunkCensus {
	byCollection: Record<string, CampusDocsDimensionCensus>;
	byCorpus: Record<string, CampusDocsDimensionCensus>;
	chunkChars: NumericDistribution;
	chunkCount: number;
	chunkSet: Sha256Ref;
	definition: typeof CHUNK_SET_DEFINITION.chunking;
	documentChunkCounts: NumericDistribution;
	documentCount: number;
	documents: CampusDocsDocumentCensus[];
	elementCounts: Record<"blockquote" | "heading" | "list" | "paragraph" | "table", number>;
	maxHeadingLevel: number;
	readerElementCount: number;
	rootUnitCounts: NumericDistribution;
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION;
	sectionChunkCounts: NumericDistribution;
	sectionCount: number;
	sections: CampusDocsSectionCensus[];
	shortChunkCount: number;
	sourceProjectionSha256: Sha256Ref;
	tableChunkCount: number;
	tableContextChunkCount: number;
	tableOnlyChunkCount: number;
	nearMaxChunkCount: number;
	multiRootChunkCount: number;
	repeatedRootUnitCount: number;
	sameSectionBoundaryCount: number;
	shortSectionCount: number;
	splitReaderElementCount: number;
	tinyChunkCount: number;
}

export interface CampusDocsReviewRootUnit {
	chars: number;
	kind: "blockquote" | "list" | "paragraph" | "table";
	rootUnitId: string;
	textPreview: string;
}

export interface CampusDocsReviewChunk {
	chars: number;
	chunkId: string;
	chunkIndex: number;
	content: string;
	headingPath: string[];
	rootUnitIds: string[];
	rootUnits: CampusDocsReviewRootUnit[];
	sectionId: string;
	sectionTitle: string;
}

export interface CampusDocsReviewBoundary {
	combinedChars: number | null;
	nextChunkId: string;
	nextFirst: string;
	nextIndex: number;
	previousChunkId: string;
	previousEnd: string;
	previousIndex: number;
	riskCodes: string[];
	sameSection: boolean;
}

export type CampusDocsReviewTag =
	| "curriculum"
	| "deep-heading"
	| "long-document"
	| "many-chunks"
	| "many-sections"
	| "multi-root"
	| "regulations"
	| "same-section-split"
	| "short-document"
	| "table-heavy"
	| "tiny-heavy"
	| "unstructured";

export interface CampusDocsReviewDocument {
	boundaries: CampusDocsReviewBoundary[];
	chunks: CampusDocsReviewChunk[];
	collection: string;
	documentId: string;
	documentTitle: string;
	metrics: CampusDocsDocumentCensus;
	primaryStratum?: string;
	tags: CampusDocsReviewTag[];
	corpus: string;
}

export type CampusDocsReviewCandidateSignal =
	| "many-root-units"
	| "mergeable-short-tail"
	| "near-max-multi-root"
	| "section-fragment"
	| "short-table-chunk"
	| "source-url-only"
	| "split-reader-element"
	| "standalone-document-metadata"
	| "table-context-overhead";

export interface CampusDocsReviewCandidate {
	chunkIndex: number;
	detail: string;
	documentId: string;
	sectionId?: string;
	signal: CampusDocsReviewCandidateSignal;
	title: string;
}

export interface CampusDocsReviewEmbeddingAnchor {
	question: string;
	questionId: string;
	rank: number;
	stratum: string;
}

export type CampusDocsReviewItemStratum =
	| "control"
	| "coverage-fill"
	| "embedding-evidence"
	| "many-root-or-split-reader"
	| "mergeable-short-tail"
	| "metadata-or-near-max"
	| "section-fragment"
	| "short-table-chunk"
	| "table-context-overhead";

export interface CampusDocsReviewItem {
	boundaries: {
		next?: CampusDocsReviewBoundary;
		previous?: CampusDocsReviewBoundary;
	};
	chunk: CampusDocsReviewChunk;
	collection: string;
	corpus: string;
	documentId: string;
	documentTags: CampusDocsReviewTag[];
	documentTitle: string;
	embeddingAnchors: CampusDocsReviewEmbeddingAnchor[];
	primaryStratum: CampusDocsReviewItemStratum;
	signals: CampusDocsReviewCandidate[];
}

export interface CampusDocsReviewItemCountSummary {
	documentCount: number;
	itemCount: number;
}

export interface CampusDocsReviewItemSummary {
	embeddingAnchorCount: number;
	embeddingAnchoredItemCount: number;
	maxItemsPerDocument: number;
	populationCandidateChunkCount: number;
	populationChunkCount: number;
	populationDocumentCount: number;
	selectedDocumentCount: number;
	selectedItemCount: number;
	signals: Partial<Record<CampusDocsReviewCandidateSignal, CampusDocsReviewItemCountSummary>>;
	strata: Record<CampusDocsReviewItemStratum, CampusDocsReviewItemCountSummary>;
}

export type CampusDocsReviewVerdict = "change" | "keep";
export type CampusDocsReviewAction = "attach" | "drop" | "merge" | "split" | "upstream-reader";

export interface CampusDocsReviewLabel {
	action?: CampusDocsReviewAction;
	chunkId: string;
	reason?: string;
	verdict: CampusDocsReviewVerdict;
}

export interface CampusDocsReviewLabelGroupSummary {
	changeCount: number;
	changeRate: number;
	itemCount: number;
	labeledCount: number;
}

export interface CampusDocsReviewLabelSummary {
	actions: Record<CampusDocsReviewAction, number>;
	byPrimaryStratum: Partial<
		Record<CampusDocsReviewItemStratum, CampusDocsReviewLabelGroupSummary>
	>;
	bySignal: Partial<Record<CampusDocsReviewCandidateSignal, CampusDocsReviewLabelGroupSummary>>;
	itemCount: number;
	labeledCount: number;
	unlabeledCount: number;
	verdicts: Record<CampusDocsReviewVerdict, number>;
}

export interface CampusDocsChunkGovernanceRunManifest {
	candidates: GovernanceArtifactReference;
	chunkSet: Sha256Ref;
	census: GovernanceArtifactReference;
	definition: typeof CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION;
	embeddingEvaluation?: Sha256Ref;
	reviewItemCount: number;
	reviewItems: GovernanceArtifactReference;
	reviewItemSummary: GovernanceArtifactReference;
	sample: GovernanceArtifactReference;
	sampleCount: number;
	sampleSummary: GovernanceArtifactReference;
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION;
	sourceProjectionSha256: Sha256Ref;
}

export interface CampusDocsChunkGovernanceRunData {
	candidates: CampusDocsReviewCandidate[];
	census: CampusDocsChunkCensus;
	manifest: CampusDocsChunkGovernanceRunManifest;
	reviewItems: CampusDocsReviewItem[];
	reviewItemSummary: CampusDocsReviewItemSummary;
	sample: CampusDocsReviewDocument[];
	run: Sha256Ref;
}

export interface CampusDocsChunkGovernanceResult {
	candidateCount: number;
	chunkCount: number;
	documentCount: number;
	outputDirectory: string;
	reviewItemCount: number;
	run: Sha256Ref;
	sampleCount: number;
	sourceProjectionSha256: Sha256Ref;
}

export interface CampusDocsChunkRunSummary {
	algorithm: string;
	chunkChars: NumericDistribution;
	chunkCount: number;
	chunkCountByDocument: NumericDistribution;
	chunkCountBySection: NumericDistribution;
	chunkSet: Sha256Ref;
	documentCount: number;
	multiRootChunkCount: number;
	nearMaxChunkCount: number;
	sectionCount: number;
	shortChunkCount: number;
	shortChunkRatio: number;
	sourceProjectionSha256: Sha256Ref;
	tinyChunkCount: number;
	tinyChunkRatio: number;
}

export interface NumericDelta {
	baseline: number;
	candidate: number;
	delta: number;
}

export interface NumericDistributionDelta {
	baseline: NumericDistribution;
	candidate: NumericDistribution;
	delta: NumericDistribution;
}

export interface CampusDocsChunkCorpusDelta {
	chunkChars: NumericDistributionDelta;
	chunkCount: NumericDelta;
	chunkCountByDocument: NumericDistributionDelta;
	chunkCountBySection: NumericDistributionDelta;
	documentCount: NumericDelta;
	multiRootChunkCount: NumericDelta;
	nearMaxChunkCount: NumericDelta;
	sectionCount: NumericDelta;
	shortChunkCount: NumericDelta;
	shortChunkRatio: NumericDelta;
	tinyChunkCount: NumericDelta;
	tinyChunkRatio: NumericDelta;
}

export interface CampusDocsChunkSourceAlignment {
	baselineOnlyDocumentIds: string[];
	candidateOnlyDocumentIds: string[];
	commonDocumentCount: number;
	sourceProjectionEqual: boolean;
	baselineSourceProjectionSha256: Sha256Ref;
	candidateSourceProjectionSha256: Sha256Ref;
}

export interface CampusDocsEvidencePlacement {
	allEvidenceInSingleChunk: boolean;
	documentPresent: boolean;
	evidenceChunkIds: string[];
	evidenceChunkIdsByEvidence: string[][];
	missingEvidenceCount: number;
}

export interface CampusDocsRetrievalEvidence {
	rootUnitIds?: string[];
	text: string;
}

export interface CampusDocsRetrievalQuestion {
	answer: string;
	documentId: string;
	evidence: CampusDocsRetrievalEvidence[];
	question: string;
	questionId: string;
	stratum: string;
}

export interface CampusDocsEvidenceComparison {
	baseline: CampusDocsEvidencePlacement;
	candidate: CampusDocsEvidencePlacement;
	questionId: string;
	status: "candidate-only" | "fixed" | "not-comparable" | "regressed" | "unchanged";
}

export interface CampusDocsChunkComparisonReport {
	baseline: CampusDocsChunkRunSummary;
	candidate: CampusDocsChunkRunSummary;
	corpusDelta: CampusDocsChunkCorpusDelta;
	embedding?: CampusDocsChunkEmbeddingComparison;
	evidenceComparisons: CampusDocsEvidenceComparison[];
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION;
	sourceAlignment: CampusDocsChunkSourceAlignment;
}

export interface CampusDocsChunkComparisonRunManifest {
	baselineEvaluation?: Sha256Ref;
	baselineChunkSet: Sha256Ref;
	candidateEvaluation?: Sha256Ref;
	candidateChunkSet: Sha256Ref;
	definition: typeof CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION;
	questionCount: number;
	questions?: GovernanceArtifactReference;
	report: GovernanceArtifactReference;
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_COMPARISON_RUN_SCHEMA_VERSION;
}

export type CampusDocsRecallMetricName =
	| "allEvidenceRecallAt"
	| "answerEvidenceRecallAt"
	| "documentRecallAt"
	| "singleChunkAnswerRecallAt"
	| "targetChunkRecallAt";

export type CampusDocsMeanMetricName =
	| "meanAnswerReciprocalRank"
	| "meanDocumentReciprocalRank"
	| "meanReciprocalRank"
	| "meanSingleChunkAnswerReciprocalRank";

export interface CampusDocsRetrievalMetricComparison {
	mean: Record<CampusDocsMeanMetricName, NumericDelta>;
	recallAt: Record<CampusDocsRecallMetricName, Record<"1" | "3" | "5" | "10", NumericDelta>>;
}

export interface CampusDocsRankingChangeSummary {
	commonQuestionCount: number;
	improved: number;
	regressed: number;
	unchanged: number;
}

export interface CampusDocsChunkEmbeddingComparison {
	baselineEvaluationRun: Sha256Ref;
	baselineQuestionCount: number;
	candidateEvaluationRun: Sha256Ref;
	candidateQuestionCount: number;
	commonQuestionCount: number;
	metrics: {
		byStratum: Record<string, CampusDocsRetrievalMetricComparison>;
		overall: CampusDocsRetrievalMetricComparison;
	};
	rankingChanges: Record<
		"allEvidenceRank" | "answerEvidenceRank" | "firstDocumentRank" | "firstEvidenceRank",
		CampusDocsRankingChangeSummary
	>;
}

export interface CampusDocsChunkComparisonResult {
	baselineChunkSet: Sha256Ref;
	candidateChunkSet: Sha256Ref;
	outputDirectory: string;
	report: CampusDocsChunkComparisonReport;
	run: Sha256Ref;
}

export interface CampusDocsRankedChunk {
	chunkId: string;
	content: string;
	documentId: string;
	documentTitle: string;
	rank: number;
	rootUnitIds: string[];
	score: number;
	sectionId: string;
	sectionTitle: string;
}

export interface CampusDocsQuestionRanking {
	allEvidenceRank: number;
	answer: string;
	answerEvidenceRank: number;
	documentId: string;
	evidenceChunkIds: string[];
	evidenceChunkRanks: Record<string, number>;
	firstEvidenceRank: number;
	firstDocumentRank: number;
	question: string;
	questionId: string;
	singleChunkAnswerRank: number | null;
	stratum: string;
	topChunks: CampusDocsRankedChunk[];
}

export interface CampusDocsRetrievalMetricSlice {
	allEvidenceRecallAt: Record<"1" | "3" | "5" | "10", number>;
	answerEvidenceRecallAt: Record<"1" | "3" | "5" | "10", number>;
	meanAnswerReciprocalRank: number;
	meanDocumentReciprocalRank: number;
	meanReciprocalRank: number;
	meanSingleChunkAnswerReciprocalRank: number;
	documentRecallAt: Record<"1" | "3" | "5" | "10", number>;
	questionCount: number;
	singleChunkAnswerQuestionCount: number;
	singleChunkAnswerRecallAt: Record<"1" | "3" | "5" | "10", number>;
	targetChunkRecallAt: Record<"1" | "3" | "5" | "10", number>;
}

export interface CampusDocsChunkEmbeddingMetrics extends CampusDocsRetrievalMetricSlice {
	byStratum: Record<string, CampusDocsRetrievalMetricSlice>;
	chunkCount: number;
	definition: typeof CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding;
	multiChunkEvidenceQuestionCount: number;
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_EMBEDDING_METRICS_SCHEMA_VERSION;
	singleChunkEvidenceQuestionCount: number;
}

export interface CampusDocsChunkEmbeddingEvaluationManifest {
	chunkCount: number;
	chunkDefinition: CampusDocsGovernanceChunkDefinition;
	chunkSet: Sha256Ref;
	definition: typeof CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding;
	embeddingInputCount: number;
	metrics: GovernanceArtifactReference;
	modelTargetSha256: string;
	questionCount: number;
	questions: GovernanceArtifactReference;
	rankings: GovernanceArtifactReference;
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_EMBEDDING_EVALUATION_SCHEMA_VERSION;
}

export interface CampusDocsChunkEmbeddingEvaluationArtifact {
	evaluationRun: Sha256Ref;
	manifest: CampusDocsChunkEmbeddingEvaluationManifest;
	metrics: CampusDocsChunkEmbeddingMetrics;
	questions: CampusDocsRetrievalQuestion[];
	rankings: CampusDocsQuestionRanking[];
}

export interface CampusDocsChunkEmbeddingEvaluationResult {
	generatedEmbeddingInputCount: number;
	metrics: CampusDocsChunkEmbeddingMetrics;
	outputDirectory: string;
	reusedEmbeddingInputCount: number;
	run: Sha256Ref;
}

export interface CampusDocsCachedEmbedding {
	dense: number[];
	embeddingSpace: typeof EMBEDDING_SPACE;
	modelTargetSha256: string;
	schemaVersion: typeof CAMPUS_DOCS_CHUNK_EMBEDDING_CACHE_SCHEMA_VERSION;
	textSha256: Sha256Ref;
}
