import * as Sentry from "@sentry/react";

import type { CampusRuntimeConfig } from "../runtime/config";
import {
	normalizeCampusTelemetryRoute,
	sanitizeCampusBreadcrumb,
	sanitizeCampusSentryEvent,
	sanitizeCampusSentrySpan,
	sanitizeCampusSentryTransaction,
} from "./sentry-scrub";

let initialized = false;

export function initializeCampusBrowserSentry(
	config: Pick<CampusRuntimeConfig["sentry"], "dsn" | "environment" | "release">,
	router: unknown,
): boolean {
	if (initialized || !config.dsn) {
		return initialized;
	}
	const environment = config.environment ?? "development";
	Sentry.init({
		beforeBreadcrumb: sanitizeCampusBreadcrumb,
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
		dsn: config.dsn,
		environment,
		initialScope: {
			tags: {
				app: "campus-agent-campus-web",
				runtime: "browser",
				surface: "campus-web-browser",
			},
		},
		integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
		release: config.release ?? undefined,
		replaysOnErrorSampleRate: 0,
		replaysSessionSampleRate: 0,
		sendDefaultPii: false,
		tracePropagationTargets: [/^\//u],
		tracesSampler(context) {
			if (environment !== "production") {
				return 0;
			}
			const route = normalizeCampusTelemetryRoute(context.location?.pathname ?? context.name);
			return context.inheritOrSampleWith(route === "/c/:conversationId" ? 0.1 : 0.05);
		},
	});
	initialized = true;
	return true;
}

export const campusReactErrorHandler = Sentry.reactErrorHandler;
export const CampusSentryErrorBoundary = Sentry.ErrorBoundary;
