import type { WorkflowOperation } from "./agent-run-contract.ts";

// One persisted deadline for the request. Changing operations never renews it.
export const retrievalReserveMs = 30_000;
export const finalizationReserveMs = 5_000;

export function operationDeadlineMs(deadlineAt: string, operation: WorkflowOperation): number {
	return Math.max(
		0,
		Date.parse(deadlineAt) -
			Date.now() -
			(operation === "execute_step" || operation === "replan"
				? retrievalReserveMs
				: finalizationReserveMs),
	);
}

export function retrievalDeadlineAt(deadlineAt: string | undefined): number {
	return deadlineAt ? Date.parse(deadlineAt) - retrievalReserveMs : Number.POSITIVE_INFINITY;
}

export function sourceUnavailable(code: string | undefined): boolean {
	return (
		code === "personal_memory_recall_failed" ||
		code === "personal_memory_recall_timeout" ||
		code === "personal_memory_recall_network_failed" ||
		code === "campus_search_timeout" ||
		code === "campus_search_network_failed" ||
		code === "campus_search_unavailable" ||
		code === "campus_search_rate_limited" ||
		code === "transient_internal_query_failed"
	);
}
