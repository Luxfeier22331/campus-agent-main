import type {
	OpsOverviewResponse,
	OpsOverviewWindow,
	OpsRequestDetailResponse,
	OpsRequestListResponse,
	OpsRequestListView,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../shared/ops-contract";

export interface OpsRequestListQuery {
	cursor?: string;
	q?: string;
	requestId?: string;
	status?: OpsRequestSummary["status"];
	view?: OpsRequestListView;
	window: OpsRequestWindow;
}

export const OPS_REQUEST_PAGE_SIZE = 50;

export type OpsStatusOverview = Pick<OpsOverviewResponse, "requests" | "trends">;

export interface OpsStatusStore {
	getOverview(window: OpsOverviewWindow): Promise<OpsStatusOverview>;
	getRequestDetail(requestId: string): Promise<OpsRequestDetailResponse | null>;
	listRequests(query: OpsRequestListQuery): Promise<OpsRequestListResponse>;
	verifyReadiness(): Promise<void>;
	verifySchema(): Promise<void>;
}

export type OpsStatusStoreUnavailableReasonCode =
	| "DB_CONNECT_FAILED"
	| "DB_PERMISSION_DENIED"
	| "MISSING_SCHEMA"
	| "OPS_STATUS_STORE_UNAVAILABLE"
	| "OPS_WEB_DATABASE_URL_MISSING";

export class OpsStatusStoreUnavailableError extends Error {
	readonly reasonCode: OpsStatusStoreUnavailableReasonCode;

	constructor(reasonCode: OpsStatusStoreUnavailableReasonCode, message: string) {
		super(message);
		this.name = "OpsStatusStoreUnavailableError";
		this.reasonCode = reasonCode;
	}
}

export interface OpsStatusEnv {
	OPS_WEB_CAMPUS_WEB_URL?: string;
}

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
