export const SENTRY_CANARY_ROUTE = "/api/internal/staging-smoke/observability/sentry-canary";
export const SENTRY_CANARY_EVIDENCE_ELEMENT_ID = "__CAMPUS_SENTRY_CANARY_EVIDENCE__";
export const SENTRY_CANARY_HASH_TAG = "canary_sentinel_sha256";
export const SENTRY_CANARY_FLUSH_TIMEOUT_MS = 5_000;

const SENTINEL_PATTERN = /^[A-Za-z0-9._:-]{12,256}$/u;
const EVENT_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export interface SentryCanarySentinels {
	body: string;
	credential: string;
	header: string;
	query: string;
	user: string;
}

export interface CampusSentryCanaryRuntimeConfig {
	appApiEventId: string;
	edgeEventId: string;
	sentinelSha256: string;
	sentinels: SentryCanarySentinels;
}

export interface SentryCanaryCaptureResult {
	eventId: string;
	sentinelSha256: string;
}

interface SentryCanaryEvent {
	request?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface SentryCanaryScope {
	addEventProcessor(processor: (event: SentryCanaryEvent) => SentryCanaryEvent): void;
	setExtra(key: string, value: unknown): void;
	setTag(key: string, value: string): void;
	setUser(user: { id: string }): void;
}

export interface SentryCanaryClient {
	captureException(error: unknown): string;
	flush(timeoutMs: number): Promise<boolean>;
	withScope(callback: (scope: SentryCanaryScope) => string): string;
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

export function parseCampusSentryCanaryRuntimeConfig(
	value: unknown,
): CampusSentryCanaryRuntimeConfig | null {
	if (!(value && typeof value === "object")) {
		return null;
	}
	const input = value as Record<string, unknown>;
	const sentinelsInput =
		input.sentinels && typeof input.sentinels === "object"
			? (input.sentinels as Record<string, unknown>)
			: {};
	const sentinels = parseSentryCanarySentinels({
		body: sentinelsInput.body,
		credential: sentinelsInput.credential,
		header: sentinelsInput.header,
		query: sentinelsInput.query,
		user: sentinelsInput.user,
	});
	if (
		!sentinels ||
		typeof input.appApiEventId !== "string" ||
		!EVENT_ID_PATTERN.test(input.appApiEventId) ||
		typeof input.edgeEventId !== "string" ||
		!EVENT_ID_PATTERN.test(input.edgeEventId) ||
		input.appApiEventId === input.edgeEventId ||
		typeof input.sentinelSha256 !== "string" ||
		!SHA256_PATTERN.test(input.sentinelSha256)
	) {
		return null;
	}
	return {
		appApiEventId: input.appApiEventId,
		edgeEventId: input.edgeEventId,
		sentinelSha256: input.sentinelSha256,
		sentinels,
	};
}

export async function captureCampusSentryCanary(input: {
	client: SentryCanaryClient;
	route?: string;
	sentinels: SentryCanarySentinels;
	throwError: () => never;
}): Promise<SentryCanaryCaptureResult | null> {
	try {
		return await captureCampusSentryCanaryUnsafe(input);
	} catch {
		return null;
	}
}

async function captureCampusSentryCanaryUnsafe(input: {
	client: SentryCanaryClient;
	route?: string;
	sentinels: SentryCanarySentinels;
	throwError: () => never;
}): Promise<SentryCanaryCaptureResult | null> {
	const route = input.route ?? SENTRY_CANARY_ROUTE;
	const sentinelSha256 = await hashCanonicalSentryCanarySentinels(input.sentinels);
	let error: unknown;
	try {
		input.throwError();
	} catch (caught) {
		error = caught;
	}
	if (!error) {
		return null;
	}

	const eventId = input.client.withScope((scope) => {
		scope.setTag("route", route);
		scope.setTag(SENTRY_CANARY_HASH_TAG, sentinelSha256);
		scope.setUser({ id: input.sentinels.user });
		scope.setExtra("synthetic_sentinels", input.sentinels);
		scope.addEventProcessor((event) => {
			event.request = {
				data: { body: input.sentinels.body },
				headers: {
					authorization: `Synthetic ${input.sentinels.credential}`,
					"x-observability-canary": input.sentinels.header,
				},
				method: "POST",
				query_string: `query=${encodeURIComponent(input.sentinels.query)}`,
				url: `${route}?query=${encodeURIComponent(input.sentinels.query)}`,
			};
			return event;
		});
		return input.client.captureException(error);
	});

	if (!EVENT_ID_PATTERN.test(eventId)) {
		return null;
	}
	if (!(await input.client.flush(SENTRY_CANARY_FLUSH_TIMEOUT_MS))) {
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
