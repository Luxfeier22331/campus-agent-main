import {
	CANONICAL_EMBEDDING_MODEL,
	EMBEDDING_SPACE,
} from "@campus-agent/embedding-runtime";

import {
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
} from "./embedding-cache.ts";
import type { ArtifactReference, Sha256Ref } from "./types.ts";

export const NOTICE_EMBEDDING_SAMPLE_DEFINITION = {
	algorithm: "notice_embedding_stratified.v2",
	sampleTarget: 400,
	strata: [
		{ name: "tiny", target: 40, unit: "chunk" },
		{ name: "short", target: 40, unit: "chunk" },
		{ name: "medium", target: 40, unit: "chunk" },
		{ name: "long", target: 40, unit: "chunk" },
		{ name: "near-max", target: 40, unit: "chunk" },
		{ name: "headed", target: 40, unit: "chunk" },
		{ name: "preamble", target: 40, unit: "chunk" },
		{ name: "boundary", target: 40, unit: "boundary-pair" },
		{ name: "random-control", target: 40, unit: "chunk" },
	],
} as const;

export const NOTICE_EMBEDDING_SAMPLE_SCHEMA_VERSION = "notice_embedding_sample_run.v1" as const;
export const NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION =
	"notice_embedding_sample_report.v1" as const;
export const NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION =
	"notice_embedding_sample_report_run.v1" as const;

export type ConfiguredSampleStratum =
	(typeof NOTICE_EMBEDDING_SAMPLE_DEFINITION.strata)[number]["name"];
export type NoticeEmbeddingSampleStratum = ConfiguredSampleStratum | "coverage-fill";

export interface NoticeEmbeddingSampleBoundary {
	boundaryIndex: number;
	direction: "next" | "previous";
	nextChunkId: Sha256Ref;
	nextChunkIndex: number;
	previousChunkId: Sha256Ref;
	previousChunkIndex: number;
}

export interface NoticeEmbeddingSampleRecord {
	boundaries: NoticeEmbeddingSampleBoundary[];
	chunkId: Sha256Ref;
	chunkIndex: number;
	content: string;
	contentChars: number;
	headingPath: string[];
	noticeId: string;
	retrievalText: string;
	retrievalTextSha256: Sha256Ref;
	strata: NoticeEmbeddingSampleStratum[];
}

export interface NoticeEmbeddingSampleStratumSummary {
	eligibleCount: number;
	name: NoticeEmbeddingSampleStratum;
	selectedCount: number;
	target: number;
	unit: "chunk" | "boundary-pair";
}

export interface NoticeEmbeddingSampleManifest {
	chunkDefinition: {
		algorithm: string;
		maxChars: number;
		overlapChars: number;
		targetChars: number;
	};
	chunkRun: Sha256Ref;
	embeddingSpace: typeof EMBEDDING_SPACE;
	model: typeof CANONICAL_EMBEDDING_MODEL;
	modelTargetSha256: string;
	sample: ArtifactReference;
	sampleDefinition: typeof NOTICE_EMBEDDING_SAMPLE_DEFINITION;
	selectedChunkCount: number;
	schemaVersion: typeof NOTICE_EMBEDDING_SAMPLE_SCHEMA_VERSION;
	uniqueEmbeddingInputCount: number;
}

export interface NoticeEmbeddingSampleStatus {
	cacheStatus: "generated" | "reused";
	chunkId: Sha256Ref;
	retrievalTextSha256: Sha256Ref;
	valid: true;
}

export interface NoticeEmbeddingSampleReport {
	cacheValidation: {
		canonicalJsonPassed: true;
		embeddingSpacePassed: true;
		modelTargetPassed: true;
		schemaPassed: true;
		textSha256Passed: true;
	};
	cacheSchemaVersion: typeof NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION;
	chunkRun: Sha256Ref;
	embeddingSpace: typeof EMBEDDING_SPACE;
	finiteValuesPassed: true;
	generatedEmbeddingInputCount: number;
	modelTargetSha256: string;
	nonZeroNormPassed: true;
	passed: true;
	reusedEmbeddingInputCount: number;
	sampleRun: Sha256Ref;
	schemaVersion: typeof NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION;
	selectedChunkCount: number;
	statuses: NoticeEmbeddingSampleStatus[];
	strata: NoticeEmbeddingSampleStratumSummary[];
	uniqueEmbeddingInputCount: number;
	vectorDimensions: number;
	vectorDimensionsPassed: true;
}

export interface NoticeEmbeddingSampleReportManifest {
	modelTargetSha256: string;
	report: ArtifactReference;
	sampleRun: Sha256Ref;
	schemaVersion: typeof NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION;
}

export interface LocalNoticeEmbeddingSampleResult {
	generatedEmbeddingInputCount: number;
	outputDirectory: string;
	report: NoticeEmbeddingSampleReport;
	reportDirectory: string;
	reportRun: Sha256Ref;
	reusedEmbeddingInputCount: number;
	run: Sha256Ref;
	selectedChunkCount: number;
	uniqueEmbeddingInputCount: number;
}

export interface NoticeEmbeddingSampleSelection {
	records: NoticeEmbeddingSampleRecord[];
	strata: NoticeEmbeddingSampleStratumSummary[];
}
