import * as Sentry from "@sentry/cloudflare";

import { normalizeAppApiRoute } from "./sentry";

export function applyRequestTags(input: {
	errorCode?: string | null;
	requestId?: string | null;
	route?: string | null;
	status?: string | null;
	surface?: string | null;
}): void {
	if (input.requestId) {
		Sentry.setTag("campus.request_id", input.requestId);
	}
	if (input.surface) {
		Sentry.setTag("surface", input.surface);
	}
	if (input.route) {
		Sentry.setTag("route", normalizeAppApiRoute(input.route));
	}
	if (input.status) {
		Sentry.setTag("status", input.status);
	}
	if (input.errorCode) {
		Sentry.setTag("error_code", input.errorCode);
	}
}
