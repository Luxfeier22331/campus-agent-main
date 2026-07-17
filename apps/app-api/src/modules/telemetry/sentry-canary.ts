import * as Sentry from "@sentry/cloudflare";

export const APP_API_SENTRY_CANARY_ROUTE =
	"/api/internal/staging-smoke/observability/sentry-canary";
export const SENTRY_CANARY_HASH_TAG = "canary_sentinel_sha256";
export const SENTRY_CANARY_FLUSH_TIMEOUT_MS = 5_000;

const SENTINEL_PATTERN = /^[A-Za-z0-9._:-]{12,256}$/u;
const EVENT_ID_PATTERN = /^[0-9a-f]{32}$/u;

export interface SentryCanarySentinels {
	body: string;
	credential: string;
	header: string;
	query: string;
	user: string;
}

export interface SentryCanaryCaptureResult {
	eventId: string;
	sentinelSha256: string;
}

export class AppApiSentryCanaryError extends Error {
	constructor() {
		super("AppApiSentryCanaryError");
		this.name = "AppApiSentryCanaryError";
	}
}

export function throwAppApiSentryCanaryError(): never {
	throw new AppApiSentryCanaryError();
}

export function parseSentryCanarySentinels(input: {
	body: unknown;
	credential: unknown;
	header: unknown;
	query: unknown;
	user: unknown;
}): SentryCanarySentinels | null {
	const sentinels = {
		body: normalizeSentinel(input.body),
		credential: normalizeSentinel(input.credential),
		header: normalizeSentinel(input.header),
		query: normalizeSentinel(input.query),
		user: normalizeSentinel(input.user),
	};
	if (Object.values(sentinels).some((value) => value === null)) {
		return null;
	}
	const normalized = sentinels as SentryCanarySentinels;
	return new Set(Object.values(normalized)).size === 5 ? normalized : null;
}

export async function captureAppApiSentryCanary(
	sentinels: SentryCanarySentinels,
): Promise<SentryCanaryCaptureResult | null> {
	try {
		return await captureAppApiSentryCanaryUnsafe(sentinels);
	} catch {
		return null;
	}
}

async function captureAppApiSentryCanaryUnsafe(
	sentinels: SentryCanarySentinels,
): Promise<SentryCanaryCaptureResult | null> {
	const sentinelSha256 = await hashCanonicalSentryCanarySentinels(sentinels);
	let error: AppApiSentryCanaryError;
	try {
		throwAppApiSentryCanaryError();
	} catch (caught) {
		error = caught as AppApiSentryCanaryError;
	}

	const eventId = Sentry.withScope((scope) => {
		scope.setTag("route", APP_API_SENTRY_CANARY_ROUTE);
		scope.setTag(SENTRY_CANARY_HASH_TAG, sentinelSha256);
		scope.setUser({ id: sentinels.user });
		scope.setExtra("synthetic_sentinels", sentinels);
		scope.addEventProcessor((event) => {
			event.request = {
				data: { body: sentinels.body },
				headers: {
					authorization: `Synthetic ${sentinels.credential}`,
					"x-observability-canary": sentinels.header,
				},
				method: "POST",
				query_string: `query=${encodeURIComponent(sentinels.query)}`,
				url: `${APP_API_SENTRY_CANARY_ROUTE}?query=${encodeURIComponent(sentinels.query)}`,
			};
			return event;
		});
		return Sentry.captureException(error);
	});

	if (!EVENT_ID_PATTERN.test(eventId)) {
		return null;
	}
	if (!(await Sentry.flush(SENTRY_CANARY_FLUSH_TIMEOUT_MS))) {
		return null;
	}
	return { eventId, sentinelSha256 };
}

export async function hashCanonicalSentryCanarySentinels(
	sentinels: SentryCanarySentinels,
): Promise<string> {
	const canonical = JSON.stringify({
		body: sentinels.body,
		credential: sentinels.credential,
		header: sentinels.header,
		query: sentinels.query,
		user: sentinels.user,
	});
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSentinel(value: unknown): string | null {
	return typeof value === "string" && SENTINEL_PATTERN.test(value) ? value : null;
}
