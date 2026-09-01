export { NOTICE_CHUNK_COMPARISON_SCHEMA_VERSION } from "./comparison-model.ts";
export type {
	LocalNoticeChunkComparisonResult,
	NoticeChunkComparisonDelta,
	NoticeChunkComparisonReport,
	NoticeChunkRunSummary,
	NoticeEvidencePlacement,
	NoticeQuestionComparison,
	NoticeQuestionRankSnapshot,
	NoticeRetrievalMetricComparison,
	NumericDelta,
	RankChangeSummary,
} from "./comparison-model.ts";
export { buildNoticeChunkComparison } from "./comparison-build.ts";
export { placeNoticeQuestionEvidence } from "./comparison-placement.ts";
export { runLocalNoticeChunkComparison } from "./comparison-run.ts";
