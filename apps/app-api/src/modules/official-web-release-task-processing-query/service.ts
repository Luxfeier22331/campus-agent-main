import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";

export interface OfficialWebReleaseTaskProcessingTimelineEvent {
	eventId?: string | null;
	stage: string;
	status: string;
	occurredAt: string;
	summary: string;
	payload?: Record<string, unknown> | null;
}

export interface OfficialWebReleaseTaskProcessingRecord {
	id: string;
	schemaVersion: string;
	taskId: string;
	taskType: string;
	sourceChannel: string;
	inventoryId: string;
	jobId: string;
	runId: string;
	selectedWriteTarget: string | null;
	lifecycleStatus: string;
	latestStage: string;
	attemptCount: number;
	maxAttempts: number;
	inputSummary: Record<string, unknown>;
	outputSummary: Record<string, unknown>;
	timeline: OfficialWebReleaseTaskProcessingTimelineEvent[];
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	createdAt: string;
	updatedAt: string;
	projectedAt: string;
	producerVersion: string;
	redactionVersion: string;
	freshnessStatus: "fresh" | "stale" | "unknown";
	observedAgeSeconds: number | null;
	staleAfterSeconds: number;
	staleReasonCode: string | null;
}

export interface OfficialWebReleaseTaskProcessingListFilters {
	cursor?: string | null;
	inventoryId?: string | null;
	jobId?: string | null;
	limit?: number | null;
	q?: string | null;
	runId?: string | null;
	selectedWriteTarget?: string | null;
	status?: string | null;
	taskType?: string | null;
	updatedAfter?: string | null;
	updatedBefore?: string | null;
}

export interface NormalizedOfficialWebReleaseTaskProcessingListFilters {
	cursor: string | null;
	inventoryId: string | null;
	jobId: string | null;
	limit: number;
	q: string | null;
	runId: string | null;
	selectedWriteTarget: string | null;
	status: string | null;
	taskType: string | null;
	updatedAfter: string | null;
	updatedBefore: string | null;
}

export interface OfficialWebReleaseTaskProcessingQueryStore {
	getById(id: string): Promise<OfficialWebReleaseTaskProcessingRecord | null>;
	list(filters: NormalizedOfficialWebReleaseTaskProcessingListFilters): Promise<{
		page: {
			nextCursor: string | null;
		};
		tasks: OfficialWebReleaseTaskProcessingRecord[];
	}>;
}

export interface OfficialWebReleaseTaskProcessingQueryService {
	getById(input: {
		id: string;
		principal: ResolvedAppPrincipal;
	}): Promise<OfficialWebReleaseTaskProcessingRecord>;
	list(input: {
		filters: OfficialWebReleaseTaskProcessingListFilters;
		principal: ResolvedAppPrincipal;
	}): Promise<{
		page: {
			nextCursor: string | null;
		};
		tasks: OfficialWebReleaseTaskProcessingRecord[];
	}>;
}

export interface OfficialWebReleaseTaskProcessingQueryServiceDependencies {
	store: OfficialWebReleaseTaskProcessingQueryStore;
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
	filters: OfficialWebReleaseTaskProcessingListFilters,
): NormalizedOfficialWebReleaseTaskProcessingListFilters {
	return {
		cursor: normalizeOptionalString(filters.cursor),
		inventoryId: normalizeOptionalString(filters.inventoryId),
		jobId: normalizeOptionalString(filters.jobId),
		limit: normalizeLimit(filters.limit),
		q: normalizeOptionalString(filters.q),
		runId: normalizeOptionalString(filters.runId),
		selectedWriteTarget: normalizeOptionalString(filters.selectedWriteTarget),
		status: normalizeOptionalString(filters.status),
		taskType: normalizeOptionalString(filters.taskType),
		updatedAfter: normalizeOptionalTimestamp(filters.updatedAfter, "updatedAfter"),
		updatedBefore: normalizeOptionalTimestamp(filters.updatedBefore, "updatedBefore"),
	};
}

export function buildOfficialWebReleaseTaskProcessingQueryService(
	dependencies: OfficialWebReleaseTaskProcessingQueryServiceDependencies,
): OfficialWebReleaseTaskProcessingQueryService {
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
		code: "official_web_release_task_not_found",
		message: "Official web release task projection not found.",
		retryable: false,
		status: 404,
	});
}
