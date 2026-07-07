import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	normalizeOptionalString,
	normalizeOverviewFilters,
	normalizeRequestListFilters,
	normalizeTemporalTaskQueueListFilters,
	normalizeWorkerAutoscalerActuationListFilters,
	normalizeWorkerAutoscalerPostureListFilters,
} from "./service-normalization";
import type { OperatorQueryService, OperatorQueryServiceDependencies } from "./service-types";

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

		async getOverview(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.getOverview(normalizeOverviewFilters(input.filters));
		},

		async getRuntimeHealth(input) {
			ensureOperatorPrincipal(input.principal);
			if (!dependencies.runtimeHealthProbe) {
				throw new AppApiRouteError({
					code: "execution_runtime_health_not_configured",
					message: "Execution runtime health probe is required for operator runtime health.",
					retryable: true,
					status: 503,
				});
			}
			return dependencies.runtimeHealthProbe();
		},

		async list(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.list(normalizeRequestListFilters(input.filters));
		},

		async listTemporalTaskQueues(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listTemporalTaskQueues(
				normalizeTemporalTaskQueueListFilters(input.filters),
			);
		},

		async listAutoscalerActuations(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAutoscalerActuations(
				normalizeWorkerAutoscalerActuationListFilters(input.filters),
			);
		},

		async listAutoscalerPostures(input) {
			ensureOperatorPrincipal(input.principal);
			return dependencies.store.listAutoscalerPostures(
				normalizeWorkerAutoscalerPostureListFilters(input.filters),
			);
		},
	};
}
