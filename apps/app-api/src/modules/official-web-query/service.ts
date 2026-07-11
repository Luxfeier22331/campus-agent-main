import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type {
	OfficialWebFetchDisposition,
	OfficialWebPageChangeStatus,
	OfficialWebRunIntent,
} from "./types";

export interface OfficialWebArtifactRecord {
	artifactType: string;
	byteSize: number | null;
	contentSha256: string;
	objectKey: string;
	recordCount: number | null;
}

export interface OfficialWebSiteRecord {
	displayName: string;
	hostRoots: string[];
	id: string;
	lastFailureAt: string | null;
	lastSuccessAt: string | null;
	latestCollectorVersion: string | null;
	latestConfigVersion: string | null;
	latestIngestionDispatchStatus: string | null;
	latestIngestionExecutionErrorCode: string | null;
	latestIngestionExecutionStatus: string | null;
	latestIngestionExecutionUpdatedAt: string | null;
	latestRunId: string | null;
	latestRunStatus: string | null;
	projectedAt: string;
	siteId: string;
}

export interface OfficialWebRunRecord {
	artifacts: OfficialWebArtifactRecord[];
	collectorVersion: string | null;
	configVersion: string | null;
	failureCount: number;
	finishedAt: string | null;
	id: string;
	ingestionDispatchRef: string | null;
	ingestionDispatchStatus: string;
	ingestionExecutionErrorCode: string | null;
	ingestionExecutionErrorMessage: string | null;
	ingestionExecutionRef: string | null;
	ingestionExecutionStatus: string;
	ingestionExecutionUpdatedAt: string | null;
	lastHeartbeatAt: string | null;
	projectedAt: string;
	runId: string;
	runIntent: OfficialWebRunIntent;
	siteId: string;
	startedAt: string;
	status: string;
	summary: Record<string, unknown> | null;
}

export interface OfficialWebPageChangeRecord {
	changeStatus: OfficialWebPageChangeStatus;
	fetchDisposition: OfficialWebFetchDisposition;
	host: string;
	httpStatus: number | null;
	id: string;
	lastChangeReason: string;
	normalizedCanonicalUrl: string;
	observedAt: string;
	pageFamily: string;
	pageTitleNormalized: string;
	rawAssetId: string | null;
	rawVersionId: string | null;
	runId: string;
}

export interface OfficialWebSiteFreshnessSummary {
	changedLast24h: number;
	deletedPages: number;
	duePages: number;
	failedFetchPages: number;
	hotPages: number;
	repairPages: number;
	totalPages: number;
}

export interface OfficialWebFreshnessPageRecord {
	cadenceClass: string;
	host: string;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: OfficialWebFetchDisposition;
	lastHttpStatus: number | null;
	lastSeenAt: string;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	siteId: string;
}

export interface OfficialWebSiteFreshnessBacklog {
	deletedPages: OfficialWebFreshnessPageRecord[];
	duePages: OfficialWebFreshnessPageRecord[];
	failedFetchPages: OfficialWebFreshnessPageRecord[];
	hotPages: OfficialWebFreshnessPageRecord[];
}

export interface OfficialWebRunDetailRecord {
	pageChangeSummary: Record<string, number>;
	pageChanges: OfficialWebPageChangeRecord[];
	run: OfficialWebRunRecord;
}

export interface OfficialWebSiteDetailRecord {
	freshnessBacklog: OfficialWebSiteFreshnessBacklog;
	freshnessSummary: OfficialWebSiteFreshnessSummary;
	recentPageChanges: OfficialWebPageChangeRecord[];
	recentRuns: OfficialWebRunRecord[];
	site: OfficialWebSiteRecord;
}

export interface OfficialWebRunListFilters {
	cursor?: string | null;
	ingestionDispatchStatus?: string | null;
	limit?: number | null;
	runIntent?: string | null;
	siteId?: string | null;
	startedAfter?: string | null;
	startedBefore?: string | null;
	status?: string | null;
}

export interface NormalizedOfficialWebRunListFilters {
	cursor: string | null;
	ingestionDispatchStatus: string | null;
	limit: number;
	runIntent: OfficialWebRunIntent | null;
	siteId: string | null;
	startedAfter: string | null;
	startedBefore: string | null;
	status: string | null;
}

export interface OfficialWebQueryStore {
	getRunById(runId: string): Promise<OfficialWebRunRecord | null>;
	getSiteById(siteId: string): Promise<OfficialWebSiteRecord | null>;
	getSiteFreshnessSummary(input: {
		now: string;
		siteId: string;
	}): Promise<OfficialWebSiteFreshnessSummary>;
	listSiteFreshnessBacklog(input: {
		limit: number;
		now: string;
		siteId: string;
	}): Promise<OfficialWebSiteFreshnessBacklog>;
	listPageChangesByRunId(runId: string, limit: number): Promise<OfficialWebPageChangeRecord[]>;
	listRecentPageChangesBySiteId(
		siteId: string,
		limit: number,
	): Promise<OfficialWebPageChangeRecord[]>;
	listRecentRunsBySiteId(siteId: string, limit: number): Promise<OfficialWebRunRecord[]>;
	listRuns(filters: NormalizedOfficialWebRunListFilters): Promise<{
		page: {
			nextCursor: string | null;
		};
		runs: OfficialWebRunRecord[];
	}>;
	listSites(): Promise<{
		sites: OfficialWebSiteRecord[];
	}>;
}

export interface OfficialWebQueryService {
	getRunById(input: {
		principal: ResolvedAppPrincipal;
		runId: string;
	}): Promise<OfficialWebRunDetailRecord>;
	getSiteById(input: {
		principal: ResolvedAppPrincipal;
		siteId: string;
	}): Promise<OfficialWebSiteDetailRecord>;
	listRuns(input: {
		filters: OfficialWebRunListFilters;
		principal: ResolvedAppPrincipal;
	}): Promise<{
		page: {
			nextCursor: string | null;
		};
		runs: OfficialWebRunRecord[];
	}>;
	listSites(input: { principal: ResolvedAppPrincipal }): Promise<{
		sites: OfficialWebSiteRecord[];
	}>;
}

export interface OfficialWebQueryServiceDependencies {
	now?: () => Date;
	store: OfficialWebQueryStore;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_RUN_PAGE_CHANGE_LIMIT = 50;
const DEFAULT_SITE_FRESHNESS_BACKLOG_LIMIT = 10;
const DEFAULT_SITE_PAGE_CHANGE_LIMIT = 20;
const DEFAULT_SITE_RECENT_RUN_LIMIT = 10;
const MAX_LIMIT = 100;
const ALLOWED_RUN_INTENTS = new Set<OfficialWebRunIntent>(["baseline", "hot", "repair"]);

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

function normalizeOptionalRunIntent(value: string | null | undefined): OfficialWebRunIntent | null {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return null;
	}
	if (ALLOWED_RUN_INTENTS.has(normalized as OfficialWebRunIntent)) {
		return normalized as OfficialWebRunIntent;
	}

	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "runIntent" },
		message: "runIntent must be one of: baseline, hot, repair.",
		retryable: false,
		status: 400,
	});
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

function extractPageChangeSummary(summary: Record<string, unknown> | null): Record<string, number> {
	const normalized: Record<string, number> = {
		changedPages: 0,
		deletedPages: 0,
		failedFetchPages: 0,
		newPages: 0,
		notModifiedPages: 0,
	};

	if (!summary) {
		return normalized;
	}

	for (const key of Object.keys(normalized)) {
		const candidate = summary[key];
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			normalized[key] = candidate;
		}
	}

	return normalized;
}

export function buildOfficialWebQueryService(
	dependencies: OfficialWebQueryServiceDependencies,
): OfficialWebQueryService {
	const now = dependencies.now ?? (() => new Date());

	return {
		async getRunById(input) {
			ensureOperatorPrincipal(input.principal);
			const runId = normalizeOptionalString(input.runId);
			if (!runId) {
				throw new AppApiRouteError({
					code: "run_not_found",
					message: "Official web run not found.",
					retryable: false,
					status: 404,
				});
			}

			const run = await dependencies.store.getRunById(runId);
			if (!run) {
				throw new AppApiRouteError({
					code: "run_not_found",
					message: "Official web run not found.",
					retryable: false,
					status: 404,
				});
			}

			return {
				pageChanges: await dependencies.store.listPageChangesByRunId(
					runId,
					DEFAULT_RUN_PAGE_CHANGE_LIMIT,
				),
				pageChangeSummary: extractPageChangeSummary(run.summary),
				run,
			};
		},

		async getSiteById(input) {
			ensureOperatorPrincipal(input.principal);
			const siteId = normalizeOptionalString(input.siteId);
			if (!siteId) {
				throw new AppApiRouteError({
					code: "site_not_found",
					message: "Official web site not found.",
					retryable: false,
					status: 404,
				});
			}

			const site = await dependencies.store.getSiteById(siteId);
			if (!site) {
				throw new AppApiRouteError({
					code: "site_not_found",
					message: "Official web site not found.",
					retryable: false,
					status: 404,
				});
			}

			const currentNow = now().toISOString();
			return {
				freshnessBacklog: await dependencies.store.listSiteFreshnessBacklog({
					limit: DEFAULT_SITE_FRESHNESS_BACKLOG_LIMIT,
					now: currentNow,
					siteId,
				}),
				freshnessSummary: await dependencies.store.getSiteFreshnessSummary({
					now: currentNow,
					siteId,
				}),
				recentPageChanges: await dependencies.store.listRecentPageChangesBySiteId(
					siteId,
					DEFAULT_SITE_PAGE_CHANGE_LIMIT,
				),
				recentRuns: await dependencies.store.listRecentRunsBySiteId(
					siteId,
					DEFAULT_SITE_RECENT_RUN_LIMIT,
				),
				site,
			};
		},

		async listRuns(input) {
			ensureOperatorPrincipal(input.principal);

			return dependencies.store.listRuns({
				cursor: normalizeOptionalString(input.filters.cursor),
				ingestionDispatchStatus: normalizeOptionalString(input.filters.ingestionDispatchStatus),
				limit: normalizeLimit(input.filters.limit),
				runIntent: normalizeOptionalRunIntent(input.filters.runIntent),
				siteId: normalizeOptionalString(input.filters.siteId),
				startedAfter: normalizeOptionalTimestamp(input.filters.startedAfter, "startedAfter"),
				startedBefore: normalizeOptionalTimestamp(input.filters.startedBefore, "startedBefore"),
				status: normalizeOptionalString(input.filters.status),
			} satisfies NormalizedOfficialWebRunListFilters);
		},

		async listSites(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listSites();
		},
	};
}
