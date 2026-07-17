import * as Sentry from "@sentry/react";

import type { CampusRuntimeConfig } from "../runtime/config";
import {
	type CampusSentryCanaryRuntimeConfig,
	captureCampusSentryCanary,
	hashCanonicalSentryCanarySentinels,
	SENTRY_CANARY_EVIDENCE_ELEMENT_ID,
	type SentryCanaryCaptureResult,
	type SentryCanaryClient,
} from "./sentry-canary";
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
				return context.inheritOrSampleWith(1);
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

export interface CampusWebBrowserSentryCanaryEvidence {
	appApiEventId: string;
	browserEventId: string;
	edgeEventId: string;
	release: string;
	sentinelSha256: string;
}

export class CampusWebBrowserSentryCanaryError extends Error {
	constructor() {
		super("CampusWebBrowserSentryCanaryError");
		this.name = "CampusWebBrowserSentryCanaryError";
	}
}

export function throwCampusWebBrowserSentryCanaryError(): never {
	throw new CampusWebBrowserSentryCanaryError();
}

export async function runCampusWebBrowserSentryCanary(input: {
	canary: CampusSentryCanaryRuntimeConfig | null;
	dsn: string | null;
	environment: string | null;
	release: string | null;
}): Promise<CampusWebBrowserSentryCanaryEvidence | null> {
	try {
		return await runCampusWebBrowserSentryCanaryUnsafe(input);
	} catch {
		return null;
	}
}

async function runCampusWebBrowserSentryCanaryUnsafe(input: {
	canary: CampusSentryCanaryRuntimeConfig | null;
	dsn: string | null;
	environment: string | null;
	release: string | null;
}): Promise<CampusWebBrowserSentryCanaryEvidence | null> {
	if (!(input.canary && input.dsn && input.environment === "staging" && input.release)) {
		return null;
	}
	const canonicalHash = await hashCanonicalSentryCanarySentinels(input.canary.sentinels);
	if (canonicalHash !== input.canary.sentinelSha256) {
		return null;
	}

	const result = await captureCampusWebBrowserSentryCanary(input.canary);
	if (
		!result ||
		result.sentinelSha256 !== input.canary.sentinelSha256 ||
		new Set([input.canary.appApiEventId, input.canary.edgeEventId, result.eventId]).size !== 3
	) {
		return null;
	}

	const evidence = {
		appApiEventId: input.canary.appApiEventId,
		browserEventId: result.eventId,
		edgeEventId: input.canary.edgeEventId,
		release: input.release,
		sentinelSha256: result.sentinelSha256,
	};
	writeCampusWebBrowserSentryCanaryEvidence(evidence);
	return evidence;
}

export function captureCampusWebBrowserSentryCanary(
	canary: CampusSentryCanaryRuntimeConfig,
): Promise<SentryCanaryCaptureResult | null> {
	return captureCampusSentryCanary({
		client: browserSentryCanaryClient,
		sentinels: canary.sentinels,
		throwError: throwCampusWebBrowserSentryCanaryError,
	});
}

function writeCampusWebBrowserSentryCanaryEvidence(
	evidence: CampusWebBrowserSentryCanaryEvidence,
): void {
	const existing = document.getElementById(SENTRY_CANARY_EVIDENCE_ELEMENT_ID);
	existing?.remove();
	const marker = document.createElement("script");
	marker.id = SENTRY_CANARY_EVIDENCE_ELEMENT_ID;
	marker.type = "application/json";
	marker.textContent = JSON.stringify(evidence).replace(/</gu, "\\u003c");
	document.body.appendChild(marker);
}

const browserSentryCanaryClient: SentryCanaryClient = {
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
