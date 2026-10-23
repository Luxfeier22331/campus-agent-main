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
