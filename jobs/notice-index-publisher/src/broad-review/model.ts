import type { NoticeChunk, Sha256Ref } from "../types.ts";

export const NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY = "broad-sample-v2" as const;

const BROAD_REVIEW_MANDATORY_TAGS = [
	"table-like",
	"boundary-risk",
	"long-unstructured",
	"extreme-tiny-chunk",
	"near-max-chunk",
	"very-long-notice",
] as const satisfies readonly BroadReviewTag[];

const BROAD_REVIEW_ADDITIONAL_STRATA = [
	{ name: "same-section-split", target: 45 },
	{ name: "list-heavy", target: 45 },
	{ name: "tiny-heavy", target: 25 },
	{ name: "nested-structure", target: 25 },
	{ name: "time-contact-dense", target: 20 },
	{ name: "many-chunks", target: 15 },
	{ name: "many-primary-sections", target: 10 },
	{ name: "long-notice", target: 8 },
	{ name: "short-notice", target: 8 },
	{ name: "single-chunk", target: 9 },
] as const satisfies readonly { name: BroadReviewTag; target: number }[];

export const NOTICE_BROAD_REVIEW_DEFINITION = {
	additionalStrata: BROAD_REVIEW_ADDITIONAL_STRATA,
	algorithm: "notice_chunk_broad_sample.v2",
	mandatoryTags: BROAD_REVIEW_MANDATORY_TAGS,
	randomControlTarget: 50,
	sampleTarget: 350,
} as const;

export type BroadReviewTag =
	| "arabic-list"
	| "boundary-risk"
	| "extreme-tiny-chunk"
	| "list-heavy"
	| "long-notice"
	| "long-unstructured"
	| "many-chunks"
	| "many-primary-sections"
	| "near-max-chunk"
	| "nested-structure"
	| "random-control"
	| "same-section-split"
	| "short-notice"
	| "single-chunk"
	| "table-like"
	| "time-contact-dense"
	| "tiny-heavy"
	| "very-long-notice";

export type BroadReviewStratum = BroadReviewTag | "coverage-fill";

export interface Distribution {
	max: number;
	min: number;
	p50: number;
	p75: number;
	p90: number;
	p95: number;
}

export interface ReviewBoundary {
	boundaryIndex: number;
	nextChunkId: string;
	nextChunkIndex: number;
	nextFirstLine: string;
	nextStart: string;
	previousChunkId: string;
	previousChunkIndex: number;
	previousEnd: string;
	previousLastLine: string;
	risk: boolean;
	sameHeadingPath: boolean;
}

export interface BroadReviewNotice {
	boundaries: ReviewBoundary[];
	chunks: NoticeChunk[];
	metrics: {
		arabicListLineCount: number;
		boundaryRiskCount: number;
		cellCount: number;
		chunkChars: Distribution;
		chunkCount: number;
		dateTimeContactSignals: number;
		lineCount: number;
		numericCellCount: number;
		primarySectionCount: number;
		sameSectionBoundaryCount: number;
		secondaryHeadingCount: number;
		shortCellRatio: number;
		tinyChunkCount: number;
		totalChars: number;
	};
	noticeId: string;
	primaryStratum?: BroadReviewStratum;
	tags: BroadReviewTag[];
	title: string;
}

export interface BroadReviewCandidate {
	chunkIndex?: number;
	detail: string;
	noticeId: string;
	signal:
		| "continuation-without-local-label"
		| "near-max-multi-topic"
		| "orphan-signature"
		| "same-section-relation-risk"
		| "tiny-tail-signature"
		| "trailing-label";
	title: string;
	boundaryIndex?: number;
}

export interface LogicalTableShape {
	cells: string[];
	tableLike: boolean;
}

export interface LocalBroadReviewResult {
	outputDirectory: string;
	populationChunkCount: number;
	populationNoticeCount: number;
	run: Sha256Ref;
	sampleCount: number;
}
