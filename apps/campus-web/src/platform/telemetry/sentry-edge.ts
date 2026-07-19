import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../../index";
import {
	sanitizeCampusSentryEvent,
	sanitizeCampusSentrySpan,
	sanitizeCampusSentryTransaction,
} from "./sentry-scrub";

export function createCampusEdgeSentryOptions(env: Env): CloudflareOptions | undefined {
	const dsn = env.SENTRY_DSN?.trim();
	if (!dsn) {
		return;
	}
	const environment = env.SENTRY_ENVIRONMENT?.trim() || "development";
	return {
		beforeSend: sanitizeCampusSentryEvent,
		beforeSendSpan: sanitizeCampusSentrySpan,
		beforeSendTransaction: sanitizeCampusSentryTransaction,
		dataCollection: {
			cookies: false,
			frameContextLines: 0,
			genAI: { inputs: false, outputs: false },
			httpBodies: [],
			httpHeaders: { request: false, response: false },
			queryParams: false,
			stackFrameVariables: false,
			userInfo: false,
		},
		dsn,
		environment,
		initialScope: {
			tags: {
				app: "campus-agent-campus-web",
				runtime: "cloudflare-worker",
				surface: "campus-web-edge",
			},
		},
		integrations(defaultIntegrations) {
			return [
				...defaultIntegrations.filter(
					(integration) => integration.name !== "HttpServer" && integration.name !== "RequestData",
				),
				Sentry.httpServerIntegration({ maxRequestBodySize: "none" }),
				Sentry.requestDataIntegration({
					include: {
						cookies: false,
						data: false,
						headers: false,
						ip: false,
						query_string: false,
						url: false,
					},
				}),
			];
		},
		release: env.SENTRY_RELEASE?.trim() || undefined,
		sendDefaultPii: false,
		tracesSampler(context) {
			return context.inheritOrSampleWith(environment === "production" ? 0.02 : 1);
		},
	};
}
