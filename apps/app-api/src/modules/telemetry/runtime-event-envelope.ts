export function buildRuntimeEventEnvelope(
	input: {
		errorCode?: string | null;
		eventType: string;
		occurredAt?: string | null;
		principalType?: string | null;
		requestId?: string | null;
		requestedTool?: string | null;
		selectedTool?: string | null;
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
		"campus.request_id": input.requestId ?? null,
		requested_tool: input.requestedTool ?? null,
		selected_tool: input.selectedTool ?? null,
		status: input.status ?? null,
		surface: input.surface ?? null,
		"campus.trace_id": input.traceId ?? null,
	};
}
