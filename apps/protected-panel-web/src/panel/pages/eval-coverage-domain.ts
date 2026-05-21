import type { OperatorEvalCoverageRecord } from "../types";

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
