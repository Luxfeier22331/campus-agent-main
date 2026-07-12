import type {
	OpsObservabilityResponse,
	OpsOverviewResponse,
	OpsOverviewWindow,
	OpsRequestDetailResponse,
	OpsRequestListResponse,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../shared/ops-contract";
import { createFixtureOpsStatusStore } from "./fixture-ops-status-store.ts";
import { createPgOpsStatusStore, createPgOpsStatusStoreDatabase } from "./pg-ops-status-store.ts";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";

export interface OpsRequestListQuery {
	conversationId?: string;
	cursor?: string;
	limit: number;
	q?: string;
	requestId?: string;
	status?: OpsRequestSummary["status"];
	traceId?: string;
	window: OpsRequestWindow;
}

export type OpsStatusOverview = Pick<
	OpsOverviewResponse,
	"externalLinks" | "requests" | "temporal" | "trends"
>;

export interface OpsStatusStore {
	getOverview(window: OpsOverviewWindow): Promise<OpsStatusOverview>;
	getRequestDetail(requestId: string): Promise<OpsRequestDetailResponse | null>;
	listRequests(query: OpsRequestListQuery): Promise<OpsRequestListResponse>;
	verifyObservabilityReadAuditWrite(): Promise<void>;
	verifyReadiness(): Promise<void>;
	writeObservabilityReadAudit(input: OpsObservabilityReadAuditInput): Promise<void>;
}

export type OpsStatusStoreUnavailableReasonCode =
	| "AUDIT_WRITE_DENIED"
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

export interface OpsObservabilityReadAuditInput {
	kind: OpsObservabilityResponse["kind"];
	operatorId: string;
	operatorPrincipalClass: "human" | "service";
	readAt: string;
	recordCount: number;
	requestId: string;
	traceId: string;
	truncated: boolean;
}

export interface OpsStatusEnv {
	AXIOM_BASE_URL?: string;
	DEPLOYMENT_ENVIRONMENT?: string;
	LANGFUSE_BASE_URL?: string;
	NODE_ENV?: string;
	OPS_WEB_AXIOM_URL?: string;
	OPS_WEB_DATABASE_CA_CERT_PATH?: string;
	OPS_WEB_DATABASE_SSLMODE?: string;
	OPS_WEB_DATABASE_URL?: string;
	OPS_WEB_DB_CONNECTION_TIMEOUT_MS?: string;
	OPS_WEB_DB_IDLE_TIMEOUT_MS?: string;
	OPS_WEB_DB_POOL_MAX?: string;
	OPS_WEB_DB_STATEMENT_TIMEOUT_MS?: string;
	OPS_WEB_FIXTURE_MODE?: string;
	OPS_WEB_LANGFUSE_URL?: string;
	OPS_WEB_OPENOBSERVE_URL?: string;
	OPS_WEB_PRINCIPAL_HASH_SECRET?: string;
	OPS_WEB_SENTRY_URL?: string;
	OPS_WEB_TEMPORAL_URL?: string;
	SENTRY_BASE_URL?: string;
	TEMPORAL_BASE_URL?: string;
}

export interface PgOpsStatusStoreDatabase {
	getRequestExecution(requestId: string): Promise<OpsRequestExecutionRow | null>;
	getRequestExecutions(requestIds: string[]): Promise<OpsRequestExecutionRow[]>;
	getRequestObservabilities(requestIds: string[]): Promise<OpsRequestObservabilityRow[]>;
	getRequestObservability(requestId: string): Promise<OpsRequestObservabilityRow | null>;
	getRequestOverview(since: Date): Promise<OpsRequestOverviewRow>;
	getRequestProjection(requestId: string): Promise<OpsRequestProjectionRow | null>;
	getRequestTrends(since: Date, bucketMinutes: number): Promise<OpsRequestTrendRow[]>;
	getTemporalTaskQueues(): Promise<OpsTemporalTaskQueueRow[]>;
	listRequestProjections(
		query: OpsRequestListQuery,
		since: Date,
	): Promise<OpsRequestProjectionRow[]>;
	summarizeRequestProjections(
		query: OpsRequestListQuery,
		since: Date,
	): Promise<OpsRequestSummaryTotals>;
	verifyObservabilityReadAuditWrite(): Promise<void>;
	verifyReadiness(): Promise<void>;
	writeObservabilityReadAudit(input: OpsObservabilityReadAuditInput): Promise<void>;
}

export interface OpsRequestSummaryTotals {
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

export interface OpsRequestProjectionRow {
	completedAt: Date | null;
	conversationId: string;
	durationMs: number | null;
	errorCode: string | null;
	principalId?: string | null;
	principalType: string;
	projectedAt: Date;
	questionPreview: string;
	requestId: string;
	requestedTool: string | null;
	selectedTool: string | null;
	startedAt: Date;
	status: string;
	traceId: string;
}

export interface OpsRequestExecutionRow {
	requestId: string;
	runId: string | null;
}

export interface OpsRequestObservabilityRow {
	aclAnomalyCode: string | null;
	aclDecision: string | null;
	failClosed: boolean | null;
	measuredAt: Date;
	modelName?: string | null;
	modelProvider?: string | null;
	promptId?: string | null;
	promptVersion?: string | null;
	projectionLagMs: number | null;
	refusalClass: string | null;
	requestId: string;
	scopeClass: string | null;
	semanticOutcome: string | null;
	stageTimingJson?: unknown;
	supportingSourcesJson?: unknown;
	templateSha256?: string | null;
	traceAvailable: boolean;
	updatedAt: Date;
	workflowTraceSummaryJson?: unknown;
}

export interface OpsTemporalTaskQueueRow {
	backlogJson?: unknown;
	oldestTaskAgeJson?: unknown;
	pollerCount: number;
	projectedAt: Date;
	taskQueue: string;
	taskQueueKind?: string | null;
}

export function createUnavailableOpsStatusStore(
	reasonCode: OpsStatusStoreUnavailableReasonCode,
	message: string,
): OpsStatusStore {
	const fail = async (): Promise<never> => {
		throw new OpsStatusStoreUnavailableError(reasonCode, message);
	};
	return {
		getOverview: fail,
		getRequestDetail: fail,
		listRequests: fail,
		verifyObservabilityReadAuditWrite: fail,
		verifyReadiness: fail,
		writeObservabilityReadAudit: fail,
	};
}

export function createOpsStatusStoreFromEnv(env: OpsStatusEnv = process.env): OpsStatusStore {
	if (env.OPS_WEB_FIXTURE_MODE === "1") {
		assertFixtureModeAllowed(env);
		return createFixtureOpsStatusStore();
	}
	const databaseUrl = env.OPS_WEB_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new OpsStatusStoreUnavailableError(
			"OPS_WEB_DATABASE_URL_MISSING",
			"OPS_WEB_DATABASE_URL is required unless OPS_WEB_FIXTURE_MODE=1.",
		);
	}
	const principalHashSecret = env.OPS_WEB_PRINCIPAL_HASH_SECRET?.trim();
	if (!principalHashSecret) {
		throw new OpsStatusStoreUnavailableError(
			"OPS_STATUS_STORE_UNAVAILABLE",
			"OPS_WEB_PRINCIPAL_HASH_SECRET is required.",
		);
	}
	const databaseConfig = resolvePostgresTlsConfig({
		caCertPath: env.OPS_WEB_DATABASE_CA_CERT_PATH,
		databaseUrl,
		deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT,
		nodeEnvironment: env.NODE_ENV,
		sslMode: env.OPS_WEB_DATABASE_SSLMODE,
	});
	return createPgOpsStatusStore({
		db: createPgOpsStatusStoreDatabase(databaseConfig.connectionString, {
			connectionTimeoutMs: normalizePositiveIntegerEnv(env.OPS_WEB_DB_CONNECTION_TIMEOUT_MS),
			idleTimeoutMs: normalizePositiveIntegerEnv(env.OPS_WEB_DB_IDLE_TIMEOUT_MS),
			max: normalizePositiveIntegerEnv(env.OPS_WEB_DB_POOL_MAX),
			ssl: databaseConfig.ssl,
			statementTimeoutMs: normalizePositiveIntegerEnv(env.OPS_WEB_DB_STATEMENT_TIMEOUT_MS),
		}),
		observabilityLinks: {
			axiom: env.OPS_WEB_AXIOM_URL ?? env.AXIOM_BASE_URL,
			langfuse: env.OPS_WEB_LANGFUSE_URL ?? env.LANGFUSE_BASE_URL,
			openobserve: env.OPS_WEB_OPENOBSERVE_URL,
			sentry: env.OPS_WEB_SENTRY_URL ?? env.SENTRY_BASE_URL,
			temporal: env.OPS_WEB_TEMPORAL_URL ?? env.TEMPORAL_BASE_URL,
		},
		principalHashSecret,
	});
}

export function assertFixtureModeAllowed(env: OpsStatusEnv): void {
	const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
	const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();
	if (
		nodeEnv === "test" ||
		deploymentEnvironment === "development" ||
		deploymentEnvironment === "local"
	) {
		return;
	}
	throw new OpsStatusStoreUnavailableError(
		"OPS_STATUS_STORE_UNAVAILABLE",
		"OPS_WEB_FIXTURE_MODE is only allowed for tests or local development.",
	);
}

function normalizePositiveIntegerEnv(value: string | undefined): number | undefined {
	if (!value?.trim()) {
		return;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export { createFixtureOpsStatusStore } from "./fixture-ops-status-store.ts";
export { createPgOpsStatusStore, createPgOpsStatusStoreDatabase } from "./pg-ops-status-store.ts";
