export interface RawOperatorEvalCoverageRagasDiagnosticMetric {
	count: number;
	max: number;
	mean: number;
	min: number;
	name: string;
}

export type OperatorEvalCoverageRagasDiagnosticFailureStage =
	| "retrieval"
	| "rerank"
	| "selection"
	| "evidence_selection"
	| "synthesis"
	| "grounding"
	| "diagnostic";

export interface RawOperatorEvalCoverageRagasDiagnostic {
	caseCount: number;
	completedCaseCount: number;
	failedCaseCount: number;
	lowScoreCases: Array<{
		caseId: string;
		failureStage: OperatorEvalCoverageRagasDiagnosticFailureStage;
		metricName: string;
		score: number;
	}>;
	metrics: RawOperatorEvalCoverageRagasDiagnosticMetric[];
	stageDistribution: Array<{
		caseCount: number;
		stage: OperatorEvalCoverageRagasDiagnosticFailureStage;
	}>;
	status: "artifact_missing" | "diagnostic_attention" | "missing_for_surface" | "present";
}

export interface RawOperatorEvalCoverageGate {
	artifactId: string;
	artifactKind: string;
	caseCount: number;
	failedCount: number;
	gitHead: string;
	passedCount: number;
	profileId: string;
	reasons: string[];
	status: "failed" | "passed";
	surfaceKey: string;
}

export interface RawOperatorEvalCoverageSurfaceRecord {
	answerQualityCaseCount: number;
	coverageGaps: string[];
	goldenQrelsCaseCount: number;
	knownGapCaseCount: number;
	lastGate: RawOperatorEvalCoverageGate;
	maturityGaps: string[];
	maturityStatus: "gap" | "ready";
	profileArtifactKind: string;
	profileId: string;
	qrelsCaseCount: number;
	ragasDiagnostic: RawOperatorEvalCoverageRagasDiagnostic;
	readiness: {
		reasons: string[];
		status: "blocked" | "diagnostic_attention" | "ready";
	};
	releaseAcceptanceCaseCount: number;
	surfaceKey: string;
	uniqueExpectedDocCount: number;
}

export interface RawOperatorEvalCoverageRecord {
	denominatorSurfaces: string[];
	excludedSurfaces: Array<{
		reason: string;
		surfaceKey: string;
	}>;
	generatedAt: string;
	schemaVersion: "eval_coverage_snapshot.v1";
	snapshotId: string;
	sourceGitHead: string;
	sourceReportSchema: string;
	surfaces: RawOperatorEvalCoverageSurfaceRecord[];
}

export interface OperatorEvalCoverageSurfaceRecord extends RawOperatorEvalCoverageSurfaceRecord {
	id: string;
}

export interface OperatorEvalCoverageRecord
	extends Omit<RawOperatorEvalCoverageRecord, "surfaces"> {
	id: string;
	surfaces: OperatorEvalCoverageSurfaceRecord[];
}

export function normalizeOperatorEvalCoverageRecord(
	input: RawOperatorEvalCoverageRecord,
): OperatorEvalCoverageRecord {
	return {
		...input,
		id: input.snapshotId,
		surfaces: input.surfaces.map((surface) => ({
			...surface,
			id: surface.surfaceKey,
		})),
	};
}
