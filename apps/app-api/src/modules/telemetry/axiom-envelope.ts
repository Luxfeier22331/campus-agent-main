import type { RequestedScope } from "../integration";
import { toScopeSummary } from "./helpers";

export function buildAxiomEnvelope(
	input: {
		errorCode?: string | null;
		eventType: string;
		occurredAt?: string | null;
		principalType?: string | null;
		requestId?: string | null;
		requestedCapability?: string | null;
		requestedScope?: RequestedScope | null;
		requestedScopeSummary?: string | null;
		selectedCapability?: string | null;
		status?: string | null;
		surface?: string | null;
		traceId?: string | null;
	},
	metadata: {
		environment: string;
		now: () => Date;
		release: string | null;
	},
): Record<string, unknown> {
	return {
		environment: metadata.environment,
		error_code: input.errorCode ?? null,
		event_type: input.eventType,
		occurred_at: input.occurredAt ?? metadata.now().toISOString(),
		principal_type: input.principalType ?? null,
		release: metadata.release,
		request_id: input.requestId ?? null,
		requested_capability: input.requestedCapability ?? null,
		requested_scope_summary: input.requestedScopeSummary ?? toScopeSummary(input.requestedScope),
		selected_capability: input.selectedCapability ?? null,
		status: input.status ?? null,
		surface: input.surface ?? null,
		trace_id: input.traceId ?? null,
	};
}
