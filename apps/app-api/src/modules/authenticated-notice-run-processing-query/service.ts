import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

export interface AuthenticatedNoticeRunProcessingTimelineEvent {
	eventId?: string | null;
	occurredAt: string;
	payload?: Record<string, unknown> | null;
	stage: string;
	status: string;
	summary: string;
}

export interface AuthenticatedNoticeRunProcessingJobSummary {
	attemptCount?: number;
	jobId: string;
	lastErrorCode?: string | null;
	lastErrorMessage?: string | null;
	queueStatus: string;
	runId: string;
	selectedNoticeCount?: number;
	updatedAt?: string | null;
}

export interface AuthenticatedNoticeRunProcessingRecord {
	attemptCount: number;
	childTaskSummary: Record<string, unknown>;
	collectorRunToken: string;
	downstream: Record<string, unknown>;
	enqueueSource: string | null;
	firstObservedAt: string;
	freshnessStatus: "fresh" | "stale" | "unknown";
	id: string;
	jobSummaries: AuthenticatedNoticeRunProcessingJobSummary[];
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	lastObservedAt: string;
	latestQueueStatus: string;
	latestStage: string;
	lifecycleStatus: string;
	observedAgeSeconds: number | null;
	producerVersion: string;
	projectedAt: string;
	queueJobCount: number;
	queueStatusCounts: Record<string, number>;
	redactionVersion: string;
	replayBatchId: string | null;
	runId: string;
	runKey: string;
	siteId: string;
	sourceChannel: string;
	sourceSurface: string;
	sourceTruth: Record<string, unknown>;
	staleAfterSeconds: number;
	staleReasonCode: string | null;
	timeline: AuthenticatedNoticeRunProcessingTimelineEvent[];
}

export interface AuthenticatedNoticeRunProcessingListFilters {
	collectorRunToken?: string | null;
	cursor?: string | null;
	limit?: number | null;
	q?: string | null;
	queueStatus?: string | null;
	replayBatchId?: string | null;
	runId?: string | null;
	siteId?: string | null;
	sourceSurface?: string | null;
	status?: string | null;
	updatedAfter?: string | null;
	updatedBefore?: string | null;
}

export interface NormalizedAuthenticatedNoticeRunProcessingListFilters {
	collectorRunToken: string | null;
	cursor: string | null;
	limit: number;
	q: string | null;
	queueStatus: string | null;
	replayBatchId: string | null;
	runId: string | null;
	siteId: string | null;
	sourceSurface: string | null;
	status: string | null;
	updatedAfter: string | null;
	updatedBefore: string | null;
}

export interface AuthenticatedNoticeRunProcessingQueryStore {
	getById(id: string): Promise<AuthenticatedNoticeRunProcessingRecord | null>;
	list(filters: NormalizedAuthenticatedNoticeRunProcessingListFilters): Promise<{
		page: {
			nextCursor: string | null;
		};
		runs: AuthenticatedNoticeRunProcessingRecord[];
	}>;
}

export interface AuthenticatedNoticeRunProcessingQueryService {
	getById(input: {
		id: string;
		principal: ResolvedAppPrincipal;
	}): Promise<AuthenticatedNoticeRunProcessingRecord>;
	list(input: {
		filters: AuthenticatedNoticeRunProcessingListFilters;
		principal: ResolvedAppPrincipal;
	}): Promise<{
		page: {
			nextCursor: string | null;
		};
		runs: AuthenticatedNoticeRunProcessingRecord[];
	}>;
}

export interface AuthenticatedNoticeRunProcessingQueryServiceDependencies {
	store: AuthenticatedNoticeRunProcessingQueryStore;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
	if (!principal.permissions.operator) {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Operator access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function normalizeLimit(value: number | null | undefined): number {
	if (!(Number.isFinite(value) && value) || value < 1) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeOptionalTimestamp(
	value: string | null | undefined,
	field: string,
): string | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.valueOf())) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a valid ISO timestamp.`,
			retryable: false,
			status: 400,
		});
	}
	return parsed.toISOString();
}

function normalizeFilters(
	filters: AuthenticatedNoticeRunProcessingListFilters,
): NormalizedAuthenticatedNoticeRunProcessingListFilters {
	return {
		collectorRunToken: normalizeOptionalString(filters.collectorRunToken),
		cursor: normalizeOptionalString(filters.cursor),
		limit: normalizeLimit(filters.limit),
		q: normalizeOptionalString(filters.q),
		queueStatus: normalizeOptionalString(filters.queueStatus),
		replayBatchId: normalizeOptionalString(filters.replayBatchId),
		runId: normalizeOptionalString(filters.runId),
		siteId: normalizeOptionalString(filters.siteId),
		sourceSurface: normalizeOptionalString(filters.sourceSurface),
		status: normalizeOptionalString(filters.status),
		updatedAfter: normalizeOptionalTimestamp(filters.updatedAfter, "updatedAfter"),
		updatedBefore: normalizeOptionalTimestamp(filters.updatedBefore, "updatedBefore"),
	};
}

export function buildAuthenticatedNoticeRunProcessingQueryService(
	dependencies: AuthenticatedNoticeRunProcessingQueryServiceDependencies,
): AuthenticatedNoticeRunProcessingQueryService {
	return {
		async getById(input) {
			ensureOperatorPrincipal(input.principal);
			const id = normalizeOptionalString(input.id);
			if (!id) {
				throw notFoundError();
			}
			const record = await dependencies.store.getById(id);
			if (!record) {
				throw notFoundError();
			}
			return record;
		},

		async list(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.list(normalizeFilters(input.filters));
		},
	};
}

function notFoundError(): AppApiRouteError {
	return new AppApiRouteError({
		code: "run_processing_not_found",
		message: "Authenticated notice run processing record not found.",
		retryable: false,
		status: 404,
	});
}
