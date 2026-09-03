import type { OpsRequestListQuery } from "../contract.ts";

export const OPS_REQUEST_PAGE_SIZE = 50;

export interface PgOpsStatusStoreDatabase {
	getRequestOverview(since: Date): Promise<OpsRequestOverviewRow>;
	getRequest(requestId: string): Promise<OpsRequestDetailRow | null>;
	getRequestDiagnostics(requestId: string): Promise<OpsRequestDiagnosticsRows>;
	getRequestTrends(since: Date, bucketMinutes: number): Promise<OpsRequestTrendRow[]>;
	listRequests(query: OpsRequestListQuery, since: Date): Promise<OpsRequestRow[]>;
	summarizeRequests(query: OpsRequestListQuery, since: Date): Promise<OpsRequestSummaryTotals>;
	verifyReadiness(): Promise<void>;
	verifySchema(): Promise<void>;
}

export interface OpsRequestSummaryTotals {
	actionRequired: number;
	cancelled: number;
	completed: number;
	failed: number;
	pending: number;
	running: number;
	total: number;
}

export interface OpsRequestOverviewRow extends OpsRequestSummaryTotals {
	latestProjectedAt: Date | null;
	p95DurationMs: number | null;
}

export interface OpsRequestTrendRow {
	bucketStart: Date;
	completed: number;
	failed: number;
	p95DurationMs: number | null;
	total: number;
}

export interface OpsRequestRow {
	assistantKind: string | null;
	assistantMessagePresent: boolean;
	attentionReason: string | null;
	completedAt: Date | null;
	durationMs: number | null;
	errorCode: string | null;
	executionFailureKind: string | null;
	executionStepKind: string | null;
	executionStepStatus: string | null;
	failCloseReason: string | null;
	dataUpdatedAt: Date;
	questionPreview: string;
	questionTruncated: boolean;
	requestId: string;
	runStatus: string | null;
	attentionPriority: number | null;
	startedAt: Date;
	status: string;
	terminalReason: string | null;
}

export interface OpsRequestDetailRow extends OpsRequestRow {
	assistantMessageText: string | null;
	assistantStructuredPartsJson: unknown;
	questionText: string;
}

export interface OpsRequestStageRow {
	completedAt: Date | null;
	sanitizedPayloadJson: unknown;
	stepId: string;
	startedAt: Date | null;
	status: string;
	stepKind: string;
	updatedAt: Date;
}

export interface OpsRequestModelAttemptRow {
	cachedInputTokens: number | string | null;
	completedAt: Date | null;
	durationMs: number | string;
	failCloseReason: string;
	inputTokens: number | string | null;
	modelName: string;
	modelProvider: string;
	modelRequestCount: number | string;
	outputTokens: number | string | null;
	sanitizedPayloadJson: unknown;
	startedAt: Date | null;
	status: string;
	terminalReason: string;
	usageObserved: boolean;
}

export interface OpsRequestDiagnosticsRows {
	modelAttempts: OpsRequestModelAttemptRow[];
	stages: OpsRequestStageRow[];
}
