import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

export interface AuthenticatedNoticeProcessingTimelineEvent {
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
}

export interface AuthenticatedNoticeProcessingRecord {
	id: string;
	noticeKey: string;
	sourceChannel: string;
	sourceSurface: string;
	siteId: string;
	noticeId: string;
	title: string;
	runId: string | null;
	jobId: string | null;
	replayBatchId: string | null;
	enqueueSource: string | null;
	queueStatus: string;
	lifecycleStatus: string;
	latestStage: string;
	targetSurface: string | null;
	candidateKind: string | null;
	materializationStatus: string | null;
	releaseId: string | null;
	current: boolean;
	toolReady: boolean;
	readModelCounts: Record<string, number | string | boolean | null>;
	childTaskSummary: Record<string, unknown>;
	timeline: AuthenticatedNoticeProcessingTimelineEvent[];
	downstream: Record<string, unknown> | null;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	attemptCount: number;
	lastObservedAt: string;
	sourceUpdatedAt: string | null;
	projectedAt: string;
	producerVersion: string;
	redactionVersion: string;
}

export interface AuthenticatedNoticeProcessingListFilters {
	candidateKind?: string | null;
	cursor?: string | null;
	limit?: number | null;
	noticeId?: string | null;
	q?: string | null;
	queueStatus?: string | null;
	replayBatchId?: string | null;
	runId?: string | null;
	status?: string | null;
	targetSurface?: string | null;
	updatedAfter?: string | null;
	updatedBefore?: string | null;
}

export interface NormalizedAuthenticatedNoticeProcessingListFilters {
	candidateKind: string | null;
	cursor: string | null;
	limit: number;
	noticeId: string | null;
	q: string | null;
	queueStatus: string | null;
	replayBatchId: string | null;
	runId: string | null;
	status: string | null;
	targetSurface: string | null;
	updatedAfter: string | null;
	updatedBefore: string | null;
}

export interface AuthenticatedNoticeProcessingQueryStore {
	getByNoticeId(noticeId: string): Promise<AuthenticatedNoticeProcessingRecord | null>;
	list(filters: NormalizedAuthenticatedNoticeProcessingListFilters): Promise<{
		notices: AuthenticatedNoticeProcessingRecord[];
		page: {
			nextCursor: string | null;
		};
	}>;
}

export interface AuthenticatedNoticeProcessingQueryService {
	getByNoticeId(input: {
		noticeId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<AuthenticatedNoticeProcessingRecord>;
	list(input: {
		filters: AuthenticatedNoticeProcessingListFilters;
		principal: ResolvedAppPrincipal;
	}): Promise<{
		notices: AuthenticatedNoticeProcessingRecord[];
		page: {
			nextCursor: string | null;
		};
	}>;
}

export interface AuthenticatedNoticeProcessingQueryServiceDependencies {
	store: AuthenticatedNoticeProcessingQueryStore;
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
	filters: AuthenticatedNoticeProcessingListFilters,
): NormalizedAuthenticatedNoticeProcessingListFilters {
	return {
		candidateKind: normalizeOptionalString(filters.candidateKind),
		cursor: normalizeOptionalString(filters.cursor),
		limit: normalizeLimit(filters.limit),
		noticeId: normalizeOptionalString(filters.noticeId),
		q: normalizeOptionalString(filters.q),
		queueStatus: normalizeOptionalString(filters.queueStatus),
		replayBatchId: normalizeOptionalString(filters.replayBatchId),
		runId: normalizeOptionalString(filters.runId),
		status: normalizeOptionalString(filters.status),
		targetSurface: normalizeOptionalString(filters.targetSurface),
		updatedAfter: normalizeOptionalTimestamp(filters.updatedAfter, "updatedAfter"),
		updatedBefore: normalizeOptionalTimestamp(filters.updatedBefore, "updatedBefore"),
	};
}

export function buildAuthenticatedNoticeProcessingQueryService(
	dependencies: AuthenticatedNoticeProcessingQueryServiceDependencies,
): AuthenticatedNoticeProcessingQueryService {
	return {
		async getByNoticeId(input) {
			ensureOperatorPrincipal(input.principal);
			const noticeId = normalizeOptionalString(input.noticeId);
			if (!noticeId) {
				throw new AppApiRouteError({
					code: "notice_not_found",
					message: "Authenticated notice processing record not found.",
					retryable: false,
					status: 404,
				});
			}
			const record = await dependencies.store.getByNoticeId(noticeId);
			if (!record) {
				throw new AppApiRouteError({
					code: "notice_not_found",
					message: "Authenticated notice processing record not found.",
					retryable: false,
					status: 404,
				});
			}
			return record;
		},

		async list(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.list(normalizeFilters(input.filters));
		},
	};
}
