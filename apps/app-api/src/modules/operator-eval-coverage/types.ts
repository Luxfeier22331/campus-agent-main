export const EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION = "eval_coverage_snapshot.v1";

export const EVAL_COVERAGE_DENOMINATOR_SURFACES = [
	"regulations/student_rules",
	"regulations/institutional_rules",
	"curriculum/curriculum_plan",
	"official_web/stable_reference",
] as const;

export type EvalCoverageSurfaceKey = (typeof EVAL_COVERAGE_DENOMINATOR_SURFACES)[number];

export interface EvalCoverageRagasDiagnosticMetric {
	count: number;
	max: number;
	mean: number;
	min: number;
	name: string;
}

export interface EvalCoverageRagasDiagnostic {
	caseCount: number;
	completedCaseCount: number;
	failedCaseCount: number;
	lowScoreCases: Array<{
		caseId: string;
		metricName: string;
		score: number;
	}>;
	metrics: EvalCoverageRagasDiagnosticMetric[];
	status: "artifact_missing" | "diagnostic_attention" | "missing_for_surface" | "present";
}

export interface EvalCoverageGateSnapshot {
	artifactId: string;
	artifactKind: string;
	caseCount: number;
	failedCount: number;
	gitHead: string;
	passedCount: number;
	profileId: string;
	reasons: string[];
	status: "failed" | "passed";
	surfaceKey: EvalCoverageSurfaceKey;
}

export interface EvalCoverageSurfaceSnapshot {
	answerQualityCaseCount: number;
	coverageGaps: string[];
	goldenQrelsCaseCount: number;
	knownGapCaseCount: number;
	lastGate: EvalCoverageGateSnapshot;
	maturityGaps: string[];
	maturityStatus: "gap" | "ready";
	profileArtifactKind: string;
	profileId: string;
	qrelsCaseCount: number;
	ragasDiagnostic: EvalCoverageRagasDiagnostic;
	readiness: {
		reasons: string[];
		status: "blocked" | "diagnostic_attention" | "ready";
	};
	releaseAcceptanceCaseCount: number;
	surfaceKey: EvalCoverageSurfaceKey;
	uniqueExpectedDocCount: number;
}

export interface EvalCoverageSnapshot {
	denominatorSurfaces: EvalCoverageSurfaceKey[];
	excludedSurfaces: Array<{
		reason: string;
		surfaceKey: string;
	}>;
	generatedAt: string;
	schemaVersion: typeof EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION;
	snapshotId: string;
	sourceGitHead: string;
	sourceReportSchema: string;
	surfaces: EvalCoverageSurfaceSnapshot[];
}

export interface EvalCoverageProjectionWrite {
	generatedAt: string;
	payload: EvalCoverageSnapshot;
	schemaVersion: typeof EVAL_COVERAGE_SNAPSHOT_SCHEMA_VERSION;
	snapshotId: string;
	sourceGitHead: string;
}
