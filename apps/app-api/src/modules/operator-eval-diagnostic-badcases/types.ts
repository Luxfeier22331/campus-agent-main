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
}
