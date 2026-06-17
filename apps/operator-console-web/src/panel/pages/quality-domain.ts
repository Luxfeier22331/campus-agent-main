import { PANEL_COPY } from "../panel-copy";
import type { OperatorQualityTimeseriesRecord } from "../types";

function roundPercentage(value: number | null) {
	if (value === null) {
		return null;
	}

	return Number((value * 100).toFixed(1));
}

export function buildQualityRuntimeTrendSeries(series: OperatorQualityTimeseriesRecord["series"]) {
	return series.map((point) => ({
		bucketEnd: point.bucketEnd,
		bucketStart: point.bucketStart,
		citationMissRatePct: roundPercentage(point.citationMissRate),
		emptyRecallRatePct: roundPercentage(point.emptyRecallRate),
		feedbackCoverageRatePct: roundPercentage(point.feedbackCoverageRate),
		feedbackHelpfulRatePct: roundPercentage(point.feedbackHelpfulRate),
		feedbackUnhelpfulRatePct: roundPercentage(point.feedbackUnhelpfulRate),
		needsClarificationRatePct: roundPercentage(point.needsClarificationRate),
		noAnswerRatePct: roundPercentage(point.noAnswerRate),
		requestCount: point.requestCount,
		sampledGroundingPassRatePct: roundPercentage(point.sampledGroundingPassRate),
	}));
}

export function buildRefusalDistributionEntries(input: {
	approvalRequired: number;
	needsClarification: number;
	noAnswer: number;
	rejected: number;
}) {
	return [
		{
			count: input.needsClarification,
			key: "needsClarification",
			label: "需澄清",
		},
		{
			count: input.noAnswer,
			key: "noAnswer",
			label: PANEL_COPY.requestStatus.no_answer,
		},
		{
			count: input.approvalRequired,
			key: "approvalRequired",
			label: PANEL_COPY.requestStatus.approval_required,
		},
		{
			count: input.rejected,
			key: "rejected",
			label: PANEL_COPY.requestStatus.rejected,
		},
	] as const;
}

export function formatQualityBadcaseStatus(status: string) {
	switch (status) {
		case "open":
			return "待处理";
		case "closed":
			return "已关闭";
		default:
			return status;
	}
}

export function formatQualityBadcaseDetectedBy(value: string) {
	switch (value) {
		case "runtime_monitor":
			return "在线监测";
		case "sampled_grading":
			return "采样评分";
		case "ragas_diagnostic":
			return "诊断评分";
		default:
			return value;
	}
}

export function formatQualityBadcaseCauseClass(value: string) {
	switch (value) {
		case "citation_missing":
			return "引用缺失";
		case "empty_recall":
			return "空召回";
		case "answer_relevancy_low":
			return "答案相关性低";
		case "diagnostic_attention":
			return "诊断关注";
		case "evidence_selection_failed":
			return "证据选择失败";
		case "retrieval_quality_low":
			return "召回质量低";
		case "synthesis_grounding_failed":
			return "证据支撑失败";
		default:
			return value;
	}
}

export function formatQualityEvalCandidateSource(value: string) {
	switch (value) {
		case "negative_feedback":
			return "负反馈";
		case "operator_badcase":
			return "Badcase";
		case "ragas_diagnostic":
			return "诊断评分";
		default:
			return value;
	}
}
