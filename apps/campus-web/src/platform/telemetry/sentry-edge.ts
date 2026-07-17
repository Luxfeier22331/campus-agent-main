import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../../index";
import {
	captureCampusSentryCanary,
	type SentryCanaryCaptureResult,
	type SentryCanaryClient,
	type SentryCanarySentinels,
} from "./sentry-canary";
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

export class CampusWebEdgeSentryCanaryError extends Error {
	constructor() {
		super("CampusWebEdgeSentryCanaryError");
		this.name = "CampusWebEdgeSentryCanaryError";
	}
}

export function throwCampusWebEdgeSentryCanaryError(): never {
	throw new CampusWebEdgeSentryCanaryError();
}

export function captureCampusWebEdgeSentryCanary(
	sentinels: SentryCanarySentinels,
): Promise<SentryCanaryCaptureResult | null> {
	return captureCampusSentryCanary({
		client: cloudflareSentryCanaryClient,
		sentinels,
		throwError: throwCampusWebEdgeSentryCanaryError,
	});
}

const cloudflareSentryCanaryClient: SentryCanaryClient = {
	captureException: (error) => Sentry.captureException(error),
	flush: (timeoutMs) => Sentry.flush(timeoutMs),
	withScope: (callback) =>
		Sentry.withScope((scope) =>
			callback({
				addEventProcessor(processor) {
					scope.addEventProcessor((event) => processor(event as never) as never);
				},
				setExtra: (key, value) => scope.setExtra(key, value),
				setTag: (key, value) => scope.setTag(key, value),
				setUser: (user) => scope.setUser(user),
			}),
		),
};
