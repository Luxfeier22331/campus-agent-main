import * as Sentry from "@sentry/cloudflare";

import type { RequestedScope } from "../integration";
import { toScopeSummary } from "./helpers";

export function applyRequestTags(input: {
	errorCode?: string | null;
	principalType?: string | null;
	requestedCapability?: string | null;
	requestedScope?: RequestedScope | null;
	route?: string | null;
	selectedCapability?: string | null;
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
	if (input.selectedCapability) {
		Sentry.setTag("selected_capability", input.selectedCapability);
	}
	if (input.requestedCapability) {
		Sentry.setTag("requested_capability", input.requestedCapability);
	}
	if (input.requestedScope) {
		Sentry.setTag("requested_scope_summary", toScopeSummary(input.requestedScope));
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
	requestedScope?: RequestedScope | null;
	resolvedScope?: RequestedScope | null;
	safetyIdentifier?: string | null;
	selectedCapability?: string | null;
}): void {
	Sentry.setContext("request", {
		conversation_id: input.conversationId ?? null,
		request_id: input.requestId ?? null,
		requested_scope_summary: toScopeSummary(input.requestedScope),
		resolved_scope_summary: toScopeSummary(input.resolvedScope),
		safety_identifier: input.safetyIdentifier ?? null,
		selected_capability: input.selectedCapability ?? null,
	});
}
