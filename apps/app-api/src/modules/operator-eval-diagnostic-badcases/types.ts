export const EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION = "eval_diagnostic_badcases.v1";

export type EvalDiagnosticFailureStage =
	| "routing"
	| "planning"
	| "tool"
	| "retrieval"
	| "rerank"
	| "selection"
	| "evidence_selection"
	| "synthesis"
	| "grounding"
	| "finalization"
	| "replan"
	| "clarification"
	| "rejected"
	| "no_answer"
	| "diagnostic";

export interface EvalDiagnosticBadcasePayloadItem {
	answerShape: string | null;
	badcaseId: string;
	caseId: string;
	causeClass: string;
	expectedDocIds: string[];
	failureStage: EvalDiagnosticFailureStage;
	metricFailureReason: string;
	metricName: string;
	presentationKind: string | null;
	queryPreview: string;
	retrievedContextIds: string[];
	retrievedDocIds: string[];
	score: number;
	supportingChunkIds: string[];
	supportingDocIds: string[];
	surfaceKey: string;
	threshold: number;
	trajectoryAttribution: EvalDiagnosticTrajectoryAttribution;
}

export type EvalDiagnosticTrajectoryAttributionStatus =
	| "attributed"
	| "attribution_missing"
	| "trajectory_missing";

export interface EvalDiagnosticTrajectoryOutcome {
	cancelOutcome: string | null;
	failCloseReason: string | null;
	lateCompletionOutcome: string | null;
	replanReason: string | null;
	terminalReason: string | null;
	timeoutOutcome: string | null;
}

export interface EvalDiagnosticTrajectoryAttribution {
	tool: string | null;
	outcome: EvalDiagnosticTrajectoryOutcome;
	projectionRefs: string[];
	status: EvalDiagnosticTrajectoryAttributionStatus;
	stepId: string | null;
	stepKind: string | null;
	stepStatus: string | null;
	toolName: string | null;
}

export interface EvalDiagnosticBadcasesProjection {
	badcases: EvalDiagnosticBadcasePayloadItem[];
	evalRunId: string;
	generatedAt: string;
	schemaVersion: typeof EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION;
	snapshotId: string;
	sourceGitHead: string;
	sourceReportSchema: string;
}

export interface EvalDiagnosticBadcaseProjectionWrite {
	answerShape: string | null;
	badcaseId: string;
	caseId: string;
	causeClass: string;
	evalRunId: string;
	expectedDocIds: string[];
	failureStage: EvalDiagnosticFailureStage;
	generatedAt: string;
	metricFailureReason: string;
	metricName: string;
	presentationKind: string | null;
	projectedAt: string;
	queryPreview: string;
	retrievedContextIds: string[];
	retrievedDocIds: string[];
	scoreMilli: number;
	snapshotId: string;
	sourceGitHead: string;
	sourceReportSchema: string;
	supportingChunkIds: string[];
	supportingDocIds: string[];
	surfaceKey: string;
	thresholdMilli: number;
	trajectoryAttribution: EvalDiagnosticTrajectoryAttribution;
}
