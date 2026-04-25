import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	isAllowedTimeseriesGranularity,
	normalizeAuditListFilters,
	normalizeOptionalString,
	normalizeOverviewFilters,
	normalizeQualityBadcaseListFilters,
	normalizeRequestListFilters,
	normalizeSafetyAnomalyListFilters,
} from "./service-normalization";
import type {
	NormalizedOperatorOverviewFilters,
	OperatorQualityBadcaseListResult,
	OperatorQueryService,
	OperatorQueryServiceDependencies,
} from "./service-types";

function validateTimeseriesGranularity(filters: NormalizedOperatorOverviewFilters): void {
	if (!filters.granularity) {
		return;
	}

	if (!isAllowedTimeseriesGranularity(filters.window, filters.granularity)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message: "window and granularity combination is invalid.",
			retryable: false,
			status: 400,
		});
	}
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

function inferSuggestedEvalFamily(
	causeClass: string,
): "citation" | "grounding" | "intent" | "policy" | "unknown" {
	const normalized = causeClass.toLowerCase();
	if (normalized.includes("citation")) {
		return "citation";
	}
	if (
		normalized.includes("intent") ||
		normalized.includes("routing") ||
		normalized.includes("classifier") ||
		normalized.includes("context_resolution") ||
		normalized.includes("missing_slot") ||
		normalized.includes("handoff")
	) {
		return "intent";
	}
	if (
		normalized.includes("policy") ||
		normalized.includes("acl") ||
		normalized.includes("authz") ||
		normalized.includes("access") ||
		normalized.includes("restricted") ||
		normalized.includes("approval")
	) {
		return "policy";
	}
	if (
		normalized.includes("ground") ||
		normalized.includes("recall") ||
		normalized.includes("retrieval") ||
		normalized.includes("evidence") ||
		normalized.includes("freshness")
	) {
		return "grounding";
	}

	return "unknown";
}

function toQualityEvalCandidates(badcases: OperatorQualityBadcaseListResult) {
	return {
		candidates: badcases.badcases.map((badcase) => ({
			candidateId: `eval_candidate:${badcase.badcaseId}`,
			causeClass: badcase.causeClass,
			grade: badcase.grade,
			intake: {
				createdAt: badcase.openedAt,
				source: "operator_badcase" as const,
				status: "pending_review" as const,
				suggestedEvalFamily: inferSuggestedEvalFamily(badcase.causeClass),
			},
			links: badcase.links,
			requestId: badcase.requestId,
			selectedTarget: badcase.selectedTarget,
			summary: badcase.summary,
			surface: badcase.surface,
			traceId: badcase.traceId,
		})),
		page: badcases.page,
	};
}

export function buildOperatorQueryService(
	dependencies: OperatorQueryServiceDependencies,
): OperatorQueryService {
	return {
		async getById(input) {
			ensureOperatorPrincipal(input.principal);
			const requestId = normalizeOptionalString(input.requestId);
			if (!requestId) {
				throw new AppApiRouteError({
					code: "invalid_request_id",
					message: "requestId is required.",
					retryable: false,
					status: 400,
				});
			}

			const projection = await dependencies.store.getById(requestId);
			if (!projection) {
				throw new AppApiRouteError({
					code: "request_not_found",
					message: "Request projection not found.",
					retryable: false,
					status: 404,
				});
			}

			return projection;
		},

		async getObservabilityById(input) {
			ensureOperatorPrincipal(input.principal);
			const requestId = normalizeOptionalString(input.requestId);
			if (!requestId) {
				throw new AppApiRouteError({
					code: "invalid_request_id",
					message: "requestId is required.",
					retryable: false,
					status: 400,
				});
			}

			const projection = await dependencies.store.getObservabilityById(requestId);
			if (!projection) {
				throw new AppApiRouteError({
					code: "request_not_found",
					message: "Request observability not found.",
					retryable: false,
					status: 404,
				});
			}

			return projection;
		},

		async getAuditById(input) {
			ensureOperatorPrincipal(input.principal);
			const auditEventId = normalizeOptionalString(input.auditEventId);
			if (!auditEventId) {
				throw new AppApiRouteError({
					code: "invalid_audit_event_id",
					message: "auditEventId is required.",
					retryable: false,
					status: 400,
				});
			}

			const event = await dependencies.store.getAuditById(auditEventId);
			if (!event) {
				throw new AppApiRouteError({
					code: "audit_event_not_found",
					message: "Audit event not found.",
					retryable: false,
					status: 404,
				});
			}

			return event;
		},

		async getOverview(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getOverview(normalizeOverviewFilters(input.filters));
		},

		async getQualitySummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getQualitySummary(normalizeOverviewFilters(input.filters));
		},

		async getQualityTimeseries(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeOverviewFilters(input.filters);
			validateTimeseriesGranularity(filters);
			return dependencies.store.getQualityTimeseries(filters);
		},

		async getSafetySummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getSafetySummary(normalizeOverviewFilters(input.filters));
		},

		async listSafetyAnomalies(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listSafetyAnomalies(
				normalizeSafetyAnomalyListFilters(input.filters),
			);
		},

		async getCostSummary(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getCostSummary(normalizeOverviewFilters(input.filters));
		},

		async getCostTimeseries(input) {
			ensureOperatorPrincipal(input.principal);
			const filters = normalizeOverviewFilters(input.filters);
			validateTimeseriesGranularity(filters);
			return dependencies.store.getCostTimeseries(filters);
		},

		async list(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.list(normalizeRequestListFilters(input.filters));
		},

		async listAudit(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAudit(normalizeAuditListFilters(input.filters));
		},

		async listQualityBadcases(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listQualityBadcases(
				normalizeQualityBadcaseListFilters(input.filters),
			);
		},

		async listQualityEvalCandidates(input) {
			ensureOperatorPrincipal(input.principal);
			const badcases = await dependencies.store.listQualityBadcases(
				normalizeQualityBadcaseListFilters(input.filters),
			);
			return toQualityEvalCandidates(badcases);
		},
	};
}
