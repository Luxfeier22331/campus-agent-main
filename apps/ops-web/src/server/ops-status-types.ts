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
	conversationId?: string;
	cursor?: string;
	q?: string;
	requestId?: string;
	runId?: string;
	status?: OpsRequestSummary["status"];
	traceId?: string;
	view?: OpsRequestListView;
	window: OpsRequestWindow;
	workflowId?: string;
}

export const OPS_REQUEST_PAGE_SIZE = 50;

export type OpsStatusOverview = Pick<OpsOverviewResponse, "externalLinks" | "requests" | "trends">;

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
	OPS_WEB_LANGFUSE_URL?: string;
	OPS_WEB_SENTRY_BASE_URL?: string;
	OPS_WEB_TEMPORAL_UI_URL?: string;
	SENTRY_ORG_SLUG?: string;
}

export interface PgOpsStatusStoreDatabase {
	getAgentUsages(runIds: string[]): Promise<OpsAgentUsageRow[]>;
	getRequestOverview(since: Date): Promise<OpsRequestOverviewRow>;
	getRequest(requestId: string): Promise<OpsRequestDetailRow | null>;
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
	admissionStatus: string;
	assistantKind: string | null;
	assistantMessagePresent: boolean;
	attentionReason: string | null;
	completedAt: Date | null;
	conversationId: string;
	durationMs: number | null;
	errorCode: string | null;
	dataUpdatedAt: Date;
	questionPreview: string;
	questionTruncated: boolean;
	requestId: string;
	runId: string | null;
	runStatus: string | null;
	runtimeVersionsJson: unknown;
	attentionPriority: number | null;
	startedAt: Date;
	status: string;
	surface: string;
	terminalReason: string | null;
	traceId: string;
	turnSequence: number;
	workflowId: string | null;
}

export interface OpsRequestDetailRow extends OpsRequestRow {
	assistantMessageText: string | null;
	assistantStructuredPartsJson: unknown;
	questionText: string;
}

export interface OpsAgentUsageRow {
	cachedInputTokens: number | string | null;
	inputTokens: number | string | null;
	observedAttemptCount: number | string;
	outputTokens: number | string | null;
	runId: string;
	totalAttemptCount: number | string;
}
