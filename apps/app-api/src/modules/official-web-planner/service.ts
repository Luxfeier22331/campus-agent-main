import { AppApiRouteError } from "../../http";
import type { OfficialWebCollectorPrincipal } from "../auth";
import type { OfficialWebFetchDisposition, OfficialWebRunIntent } from "../official-web-command";

export interface OfficialWebPlannerPageCandidate {
	cadenceClass: string;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: string;
	etag: string | null;
	host: string;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: OfficialWebFetchDisposition;
	lastHttpStatus: number | null;
	lastModified: string | null;
	lastNotModifiedAt: string | null;
	lastSeenAt: string;
	lastSuccessfulRunId: string | null;
	mainContentHash: string | null;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	responseBodyHash: string | null;
	siteId: string;
}

export interface OfficialWebPlannerResolvePayload {
	hostFilter?: unknown;
	maxPagesPerHost?: unknown;
	maxTotalPages?: unknown;
	now?: unknown;
	runIntent?: unknown;
	siteId?: unknown;
}

export interface NormalizedOfficialWebPlannerFilters {
	hostFilter: string[];
	maxPagesPerHost: number;
	maxTotalPages: number;
	now: string;
	runIntent: OfficialWebRunIntent;
	siteId: string;
}

export interface OfficialWebPlannerStore {
	listDuePages(
		filters: NormalizedOfficialWebPlannerFilters,
	): Promise<OfficialWebPlannerPageCandidate[]>;
}

export interface OfficialWebPlannerService {
	resolve(input: {
		payload: OfficialWebPlannerResolvePayload;
		principal: OfficialWebCollectorPrincipal;
	}): Promise<{
		plan: {
			duePages: OfficialWebPlannerPageCandidate[];
			hostFilter: string[];
			maxPagesPerHost: number;
			maxTotalPages: number;
			resolvedAt: string;
			runIntent: OfficialWebRunIntent;
			siteId: string;
			summary: {
				duePages: number;
				listingPages: number;
				repairPages: number;
				selectedHosts: number;
				staticPages: number;
			};
		};
	}>;
}

export interface OfficialWebPlannerServiceDependencies {
	store: OfficialWebPlannerStore;
}

const ALLOWED_RUN_INTENTS = new Set<OfficialWebRunIntent>(["baseline", "hot", "repair"]);

function requireCollectorPrincipal(principal: OfficialWebCollectorPrincipal): void {
	if (principal.kind !== "service" || principal.serviceClass !== "official_web_collector") {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Collector planner access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

function normalizeString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a positive integer.`,
			retryable: false,
			status: 422,
		});
	}

	const normalized = Math.floor(value);
	if (normalized < 1) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a positive integer.`,
			retryable: false,
			status: 422,
		});
	}

	return normalized;
}

function normalizeHostFilter(value: unknown): string[] {
	if (value == null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "hostFilter" },
			message: "hostFilter must be an array of host strings.",
			retryable: false,
			status: 422,
		});
	}

	const normalizedHosts = value.map((item, index) => {
		const normalized = normalizeString(item);
		if (!normalized) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `hostFilter[${index}]` },
				message: "hostFilter entries must be non-empty host strings.",
				retryable: false,
				status: 422,
			});
		}
		return normalized.toLowerCase();
	});

	return [...new Set(normalizedHosts)];
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a valid ISO timestamp.`,
			retryable: false,
			status: 422,
		});
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.valueOf())) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a valid ISO timestamp.`,
			retryable: false,
			status: 422,
		});
	}

	return parsed.toISOString();
}

function normalizeResolvePayload(
	payload: OfficialWebPlannerResolvePayload,
): NormalizedOfficialWebPlannerFilters {
	const siteId = normalizeString(payload.siteId);
	const runIntent = normalizeString(payload.runIntent) as OfficialWebRunIntent | null;
	if (!(siteId && runIntent && ALLOWED_RUN_INTENTS.has(runIntent))) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field: "siteId|runIntent" },
			message: "siteId and a valid runIntent are required.",
			retryable: false,
			status: 422,
		});
	}

	return {
		hostFilter: normalizeHostFilter(payload.hostFilter),
		maxPagesPerHost: normalizePositiveInteger(payload.maxPagesPerHost, "maxPagesPerHost"),
		maxTotalPages: normalizePositiveInteger(payload.maxTotalPages, "maxTotalPages"),
		now: payload.now == null ? new Date().toISOString() : normalizeIsoTimestamp(payload.now, "now"),
		runIntent,
		siteId,
	};
}

export function buildOfficialWebPlannerService(
	dependencies: OfficialWebPlannerServiceDependencies,
): OfficialWebPlannerService {
	return {
		async resolve(input) {
			requireCollectorPrincipal(input.principal);
			const filters = normalizeResolvePayload(input.payload);
			const duePages = await dependencies.store.listDuePages(filters);
			const selectedHosts = new Set<string>();
			let listingPages = 0;
			let repairPages = 0;
			let staticPages = 0;

			for (const page of duePages) {
				selectedHosts.add(page.host);
				if (page.cadenceClass === "listing_hot") {
					listingPages += 1;
				} else if (page.cadenceClass === "repair" || page.lastFetchDisposition === "fetch_failed") {
					repairPages += 1;
				} else {
					staticPages += 1;
				}
			}

			return {
				plan: {
					duePages,
					hostFilter: filters.hostFilter,
					maxPagesPerHost: filters.maxPagesPerHost,
					maxTotalPages: filters.maxTotalPages,
					resolvedAt: filters.now,
					runIntent: filters.runIntent,
					siteId: filters.siteId,
					summary: {
						duePages: duePages.length,
						listingPages,
						repairPages,
						selectedHosts: selectedHosts.size,
						staticPages,
					},
				},
			};
		},
	};
}
