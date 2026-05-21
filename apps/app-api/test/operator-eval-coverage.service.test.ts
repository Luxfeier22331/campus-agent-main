// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorObservabilityCommandService } from "../src/modules/operator-observability-command";
import { buildOperatorQueryService } from "../src/modules/operator-query";
import { createOperatorPrincipal } from "./operator-query.route.test-support";

const snapshot = {
	schemaVersion: "eval_coverage_snapshot.v1",
	snapshotId: "eval_coverage:2026-05-21T090000Z",
	generatedAt: "2026-05-21T09:00:00+00:00",
	sourceGitHead: "git-main",
	sourceReportSchema: "rag-eval-coverage-report.v1",
	denominatorSurfaces: [
		"regulations/student_rules",
		"regulations/institutional_rules",
		"curriculum/curriculum_plan",
		"official_web/stable_reference",
	],
	surfaces: [
		{
			answerQualityCaseCount: 18,
			coverageGaps: [],
			goldenQrelsCaseCount: 52,
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
				caseCount: 0,
				completedCaseCount: 0,
				failedCaseCount: 0,
				lowScoreCases: [],
				metrics: [],
				status: "artifact_missing",
			},
			readiness: {
				reasons: [],
				status: "ready",
			},
			releaseAcceptanceCaseCount: 25,
			surfaceKey: "regulations/student_rules",
			uniqueExpectedDocCount: 28,
		},
		{
			answerQualityCaseCount: 12,
			coverageGaps: [],
			goldenQrelsCaseCount: 20,
			knownGapCaseCount: 0,
			lastGate: {
				artifactId: "institutional-release-gate",
				artifactKind: "formal_final_summary",
				caseCount: 18,
				failedCount: 0,
				gitHead: "git-main",
				passedCount: 18,
				profileId: "institutional-rules-release-baseline",
				reasons: [],
				status: "passed",
				surfaceKey: "regulations/institutional_rules",
			},
			maturityGaps: [],
			maturityStatus: "ready",
			profileArtifactKind: "release_acceptance",
			profileId: "institutional-rules-release-baseline",
			qrelsCaseCount: 20,
			ragasDiagnostic: {
				caseCount: 0,
				completedCaseCount: 0,
				failedCaseCount: 0,
				lowScoreCases: [],
				metrics: [],
				status: "artifact_missing",
			},
			readiness: {
				reasons: [],
				status: "ready",
			},
			releaseAcceptanceCaseCount: 18,
			surfaceKey: "regulations/institutional_rules",
			uniqueExpectedDocCount: 11,
		},
		{
			answerQualityCaseCount: 8,
			coverageGaps: [],
			goldenQrelsCaseCount: 12,
			knownGapCaseCount: 0,
			lastGate: {
				artifactId: "curriculum-release-gate",
				artifactKind: "formal_final_summary",
				caseCount: 12,
				failedCount: 0,
				gitHead: "git-main",
				passedCount: 12,
				profileId: "curriculum",
				reasons: [],
				status: "passed",
				surfaceKey: "curriculum/curriculum_plan",
			},
			maturityGaps: [],
			maturityStatus: "ready",
			profileArtifactKind: "release_acceptance",
			profileId: "curriculum",
			qrelsCaseCount: 12,
			ragasDiagnostic: {
				caseCount: 0,
				completedCaseCount: 0,
				failedCaseCount: 0,
				lowScoreCases: [],
				metrics: [],
				status: "artifact_missing",
			},
			readiness: {
				reasons: [],
				status: "ready",
			},
			releaseAcceptanceCaseCount: 12,
			surfaceKey: "curriculum/curriculum_plan",
			uniqueExpectedDocCount: 6,
		},
		{
			answerQualityCaseCount: 0,
			coverageGaps: [],
			goldenQrelsCaseCount: 4,
			knownGapCaseCount: 0,
			lastGate: {
				artifactId: "official-stable-release-gate",
				artifactKind: "formal_final_summary",
				caseCount: 4,
				failedCount: 0,
				gitHead: "git-main",
				passedCount: 4,
				profileId: "official-web-stable-reference",
				reasons: [],
				status: "passed",
				surfaceKey: "official_web/stable_reference",
			},
			maturityGaps: [],
			maturityStatus: "ready",
			profileArtifactKind: "release_acceptance",
			profileId: "official-web-stable-reference",
			qrelsCaseCount: 4,
			ragasDiagnostic: {
				caseCount: 0,
				completedCaseCount: 0,
				failedCaseCount: 0,
				lowScoreCases: [],
				metrics: [],
				status: "artifact_missing",
			},
			readiness: {
				reasons: [],
				status: "ready",
			},
			releaseAcceptanceCaseCount: 4,
			surfaceKey: "official_web/stable_reference",
			uniqueExpectedDocCount: 3,
		},
	],
	excludedSurfaces: [
		{
			reason: "excluded from current RAG consumption denominator",
			surfaceKey: "official_web/fresh_news",
		},
	],
};

function createCommandStore() {
	return {
		enqueueExecutionAuditEvents: vi.fn(),
		getRequestObservabilitySeed: vi.fn(),
		upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
		upsertEvalDiagnosticBadcases: vi.fn(),
		upsertQualityGrades: vi.fn(),
		upsertTraceBacklinks: vi.fn(),
	};
}

describe("operator eval coverage service", () => {
	it("normalizes and persists eval coverage snapshots as operator-safe projection data", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(service.ingestEvalCoverageSnapshot({ payload: snapshot })).resolves.toEqual({
			accepted: 1,
			snapshotId: snapshot.snapshotId,
		});

		expect(store.upsertEvalCoverageSnapshot).toHaveBeenCalledWith({
			snapshot: {
				generatedAt: "2026-05-21T09:00:00.000Z",
				payload: {
					...snapshot,
					generatedAt: "2026-05-21T09:00:00.000Z",
				},
				schemaVersion: "eval_coverage_snapshot.v1",
				snapshotId: snapshot.snapshotId,
				sourceGitHead: "git-main",
			},
		});
	});

	it("rejects snapshots that include local artifact paths", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestEvalCoverageSnapshot({
				payload: {
					...snapshot,
					path: ".planning/workstreams/eval/evidence/raw.json",
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertEvalCoverageSnapshot).not.toHaveBeenCalled();
	});

	it("rejects snapshots that drift from the current denominator order", async () => {
		const store = createCommandStore();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestEvalCoverageSnapshot({
				payload: {
					...snapshot,
					denominatorSurfaces: ["regulations/student_rules", "curriculum/curriculum_plan"],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertEvalCoverageSnapshot).not.toHaveBeenCalled();
	});

	it("fails closed when no eval coverage projection has been published", async () => {
		const store = {
			getEvalCoverage: vi.fn().mockResolvedValue(null),
		};
		const service = buildOperatorQueryService({ store: store as never });

		await expect(
			service.getEvalCoverage({ principal: createOperatorPrincipal() }),
		).rejects.toMatchObject({
			code: "eval_coverage_snapshot_not_found",
			status: 404,
		});
	});
});
