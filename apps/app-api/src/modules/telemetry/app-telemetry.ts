import * as Sentry from "@sentry/cloudflare";

import { runTelemetrySideEffectWithoutRequestFailure } from "./helpers";
import { normalizeAppApiRoute } from "./sentry";
import { applyRequestTags } from "./sentry-scope";
import type { AppTelemetry } from "./types";

export function createAppTelemetry(): AppTelemetry {
	return {
		captureException(error, detail) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				Sentry.withScope((scope) => {
					if (detail?.route) {
						scope.setTag("route", normalizeAppApiRoute(detail.route));
					}
					if (detail?.status) {
						scope.setTag("status", String(detail.status));
					}
					if (detail?.surface) {
						scope.setTag("surface", detail.surface);
					}
					if (detail?.requestId) {
						scope.setTag("campus.request_id", detail.requestId);
					}

					Sentry.captureException(error);
				});
			});
		},

		configureChatRequestScope(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					requestId: input.requestId,
					status: "accepted",
					surface: input.surface,
				});
			});
		},

		configureHttpRequestScope(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					...(input.requestId === undefined ? {} : { requestId: input.requestId }),
					route: input.route,
					surface: input.surface,
				});
			});
		},

		markHttpResponseStatus(status) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				Sentry.setTag("status", String(status));
			});
		},

		configureRequestOutcome(input) {
			runTelemetrySideEffectWithoutRequestFailure(() => {
				applyRequestTags({
					errorCode: input.errorCode,
					requestId: input.requestId,
					status: input.status,
					surface: input.surface,
				});
			});
		},
	};
}
