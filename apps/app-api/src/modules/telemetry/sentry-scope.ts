import * as Sentry from "@sentry/cloudflare";

import { toTargetsSummary } from "./helpers";

export function applyRequestTags(input: {
	errorCode?: string | null;
	principalType?: string | null;
	requestedTool?: string | null;
	resolvedTargets?: string[];
	route?: string | null;
	selectedTool?: string | null;
	status?: string | null;
	surface?: string | null;
	traceId?: string | null;
}): void {
	if (input.traceId) {
		Sentry.setTag("trace_id", input.traceId);
	}
	if (input.surface) {
		Sentry.setTag("surface", input.surface);
	}
	if (input.route) {
		Sentry.setTag("route", input.route);
	}
	if (input.status) {
		Sentry.setTag("status", input.status);
	}
	if (input.selectedTool) {
		Sentry.setTag("selected_tool", input.selectedTool);
	}
	if (input.requestedTool) {
		Sentry.setTag("requested_tool", input.requestedTool);
	}
	if (input.resolvedTargets && input.resolvedTargets.length > 0) {
		Sentry.setTag("resolved_targets_summary", toTargetsSummary(input.resolvedTargets));
	}
	if (input.principalType) {
		Sentry.setTag("principal_type", input.principalType);
	}
	if (input.errorCode) {
		Sentry.setTag("error_code", input.errorCode);
	}
}

export function applyRequestContext(input: {
	conversationId?: string | null;
	requestId?: string | null;
	resolvedTargets?: string[];
	safetyIdentifier?: string | null;
	selectedTool?: string | null;
}): void {
	Sentry.setContext("request", {
		conversation_id: input.conversationId ?? null,
		request_id: input.requestId ?? null,
		resolved_targets: input.resolvedTargets ?? [],
		safety_identifier: input.safetyIdentifier ?? null,
		selected_tool: input.selectedTool ?? null,
	});
}
