import type {
	OperatorEvalCoverageRagasDiagnosticFailureStage,
	OperatorEvalCoverageRecord,
	RawOperatorEvalCoverageRagasDiagnostic,
	RawOperatorEvalCoverageRagasDiagnosticMetric,
} from "../types";

function rejectUnsupportedRagasFailureStage(stage: never): never {
	throw new Error(`Unsupported RAGAS diagnostic failure stage: ${String(stage)}`);
}

export function buildEvalCoverageSummary(record: OperatorEvalCoverageRecord) {
	const summary = {
		blockedSurfaceCount: 0,
		diagnosticAttentionSurfaceCount: 0,
		excludedSurfaceCount: record.excludedSurfaces.length,
		readySurfaceCount: 0,
		surfaceCount: record.surfaces.length,
		totalAnswerQualityCases: 0,
		totalKnownGapCases: 0,
		totalQrelsCases: 0,
		totalReleaseAcceptanceCases: 0,
	};

	for (const surface of record.surfaces) {
		if (surface.readiness.status === "blocked") {
			summary.blockedSurfaceCount += 1;
		}
		if (surface.readiness.status === "diagnostic_attention") {
			summary.diagnosticAttentionSurfaceCount += 1;
		}
		if (surface.readiness.status === "ready") {
			summary.readySurfaceCount += 1;
		}
		summary.totalAnswerQualityCases += surface.answerQualityCaseCount;
		summary.totalKnownGapCases += surface.knownGapCaseCount;
		summary.totalQrelsCases += surface.qrelsCaseCount;
		summary.totalReleaseAcceptanceCases += surface.releaseAcceptanceCaseCount;
	}

	return summary;
}

export function formatEvalCoverageReadinessStatus(status: string) {
	switch (status) {
		case "blocked":
			return "阻塞";
		case "diagnostic_attention":
			return "诊断关注";
		case "ready":
			return "可发布";
		default:
			return status;
	}
}

export function formatEvalCoverageDiagnosticStatus(status: string) {
	switch (status) {
		case "artifact_missing":
			return "未发布诊断";
		case "diagnostic_attention":
			return "诊断关注";
		case "missing_for_surface":
			return "该面缺失";
		case "present":
			return "已覆盖";
		default:
			return status;
	}
}

export function formatRagasDiagnosticStageLabel(
	stage: OperatorEvalCoverageRagasDiagnosticFailureStage,
) {
	return formatDiagnosticStageLabel(stage);
}

export function formatDiagnosticStageLabel(stage: string) {
	switch (stage) {
		case "routing":
			return "路由";
		case "planning":
			return "规划";
		case "tool":
			return "工具";
		case "retrieval":
			return "召回";
		case "rerank":
			return "重排";
		case "selection":
			return "选择";
		case "evidence_selection":
			return "证据选择";
		case "synthesis":
			return "生成";
		case "grounding":
			return "接地";
		case "finalization":
			return "终态写入";
		case "replan":
			return "重规划";
		case "clarification":
		case "needs_clarification":
			return "澄清";
		case "rejected":
			return "拒绝";
		case "no_answer":
			return "无法回答";
		case "diagnostic":
			return "诊断";
		default:
			return stage;
	}
}

export function causeClassForRagasDiagnosticFailureStage(
	stage: OperatorEvalCoverageRagasDiagnosticFailureStage,
) {
	switch (stage) {
		case "retrieval":
		case "rerank":
			return "retrieval_quality_low";
		case "selection":
		case "evidence_selection":
			return "evidence_selection_failed";
		case "synthesis":
		case "grounding":
			return "synthesis_grounding_failed";
		case "diagnostic":
			return "diagnostic_attention";
		default:
			return rejectUnsupportedRagasFailureStage(stage);
	}
}

export function formatRagasDiagnosticMetricSummary(
	metrics: RawOperatorEvalCoverageRagasDiagnosticMetric[],
) {
	if (metrics.length === 0) {
		return "none";
	}
	return metrics
		.map((metric) => `${metric.name} min ${metric.min.toFixed(3)} / mean ${metric.mean.toFixed(3)}`)
		.join("; ");
}

export function buildRagasDiagnosticStageEntries(
	diagnostic: RawOperatorEvalCoverageRagasDiagnostic,
) {
	return diagnostic.stageDistribution.map((item) => ({
		count: item.caseCount,
		label: formatRagasDiagnosticStageLabel(item.stage),
		stage: item.stage,
	}));
}

export function formatEvalCoverageSurfaceLabel(surfaceKey: string) {
	switch (surfaceKey) {
		case "regulations/student_rules":
			return "学生规章";
		case "regulations/institutional_rules":
			return "校级制度";
		case "curriculum/curriculum_plan":
			return "培养方案";
		case "official_web/stable_reference":
			return "稳定官网参考";
		default:
			return surfaceKey;
	}
}
