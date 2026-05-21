import { describe, expect, it } from "vitest";

import {
	buildEvalCoverageSummary,
	formatEvalCoverageDiagnosticStatus,
	formatEvalCoverageReadinessStatus,
} from "../src/panel/pages/eval-coverage-domain";
import type { OperatorEvalCoverageRecord } from "../src/panel/types";

const record = {
	denominatorSurfaces: [
		"regulations/student_rules",
		"regulations/institutional_rules",
		"curriculum/curriculum_plan",
		"official_web/stable_reference",
	],
	excludedSurfaces: [
		{
			reason: "excluded from current RAG consumption denominator",
			surfaceKey: "official_web/fresh_news",
		},
	],
	generatedAt: "2026-05-21T09:00:00.000Z",
	id: "eval_coverage:2026-05-21T090000Z",
	schemaVersion: "eval_coverage_snapshot.v1",
	snapshotId: "eval_coverage:2026-05-21T090000Z",
	sourceGitHead: "git-main",
	sourceReportSchema: "rag-eval-coverage-report.v1",
	surfaces: [
		{
			answerQualityCaseCount: 18,
			coverageGaps: [],
			goldenQrelsCaseCount: 52,
			id: "regulations/student_rules",
			knownGapCaseCount: 4,
			lastGate: {
				artifactId: "student-rules-release-gate",
				artifactKind: "formal_final_summary",
				caseCount: 25,
				failedCount: 0,
				gitHead: "git-main",
				passedCount: 25,
				profileId: "handbook",
				reasons: [],
				status: "passed",
				surfaceKey: "regulations/student_rules",
			},
			maturityGaps: [],
			maturityStatus: "ready",
			profileArtifactKind: "release_acceptance",
			profileId: "handbook",
			qrelsCaseCount: 52,
			ragasDiagnostic: {
				caseCount: 2,
				completedCaseCount: 2,
				failedCaseCount: 0,
				lowScoreCases: [
					{
						caseId: "student-case",
						metricName: "answer_relevancy",
						score: 0.7,
					},
				],
				metrics: [],
				status: "diagnostic_attention",
			},
			readiness: {
				reasons: [],
				status: "diagnostic_attention",
			},
			releaseAcceptanceCaseCount: 25,
			surfaceKey: "regulations/student_rules",
			uniqueExpectedDocCount: 28,
		},
	],
} satisfies OperatorEvalCoverageRecord;

describe("eval coverage domain helpers", () => {
	it("summarizes deterministic readiness and supplemental diagnostic attention", () => {
		expect(buildEvalCoverageSummary(record)).toEqual({
			blockedSurfaceCount: 0,
			diagnosticAttentionSurfaceCount: 1,
			excludedSurfaceCount: 1,
			readySurfaceCount: 0,
			surfaceCount: 1,
			totalAnswerQualityCases: 18,
			totalKnownGapCases: 4,
			totalQrelsCases: 52,
			totalReleaseAcceptanceCases: 25,
		});
	});

	it("formats readiness and diagnostic status with explicit chinese labels", () => {
		expect(formatEvalCoverageReadinessStatus("blocked")).toBe("阻塞");
		expect(formatEvalCoverageReadinessStatus("diagnostic_attention")).toBe("诊断关注");
		expect(formatEvalCoverageReadinessStatus("ready")).toBe("可发布");
		expect(formatEvalCoverageDiagnosticStatus("artifact_missing")).toBe("未发布诊断");
		expect(formatEvalCoverageDiagnosticStatus("diagnostic_attention")).toBe("诊断关注");
		expect(formatEvalCoverageDiagnosticStatus("missing_for_surface")).toBe("该面缺失");
		expect(formatEvalCoverageDiagnosticStatus("present")).toBe("已覆盖");
	});
});
