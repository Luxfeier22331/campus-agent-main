import type {
	DynamicShellNetworkCapture,
	OfficialWebDynamicShellDiscoveryPolicy,
} from "./dynamic-shell-discovery-types.ts";

export function extractPromotedUrlsFromNetworkCaptures(input: {
	baseUrl: string;
	captures: DynamicShellNetworkCapture[];
	policy: OfficialWebDynamicShellDiscoveryPolicy;
}): string[] {
	const allowedRequestMatchers = compilePatterns(input.policy.allowedRequestUrlPatterns);
	const ignoredRequestMatchers = compilePatterns(input.policy.ignoredRequestUrlPatterns);
	const promotedMatchers = compilePatterns(input.policy.promotedUrlPatterns);
	const promotedUrls = new Set<string>();

	for (const capture of input.captures) {
		if (matchesAny(capture.url, ignoredRequestMatchers)) {
			continue;
		}
		if (allowedRequestMatchers.length > 0 && !matchesAny(capture.url, allowedRequestMatchers)) {
			continue;
		}

		for (const rawValue of collectCandidateStrings(capture)) {
			const resolvedUrl = resolveCandidateUrl(rawValue, input.baseUrl);
			if (!resolvedUrl || !matchesAny(resolvedUrl, promotedMatchers)) {
				continue;
			}
			promotedUrls.add(resolvedUrl);
			if (promotedUrls.size >= input.policy.maxPromotedUrls) {
				return [...promotedUrls];
			}
		}
	}

	return [...promotedUrls];
}

export function resolveCandidateUrl(candidate: string, baseUrl: string): string | null {
	const trimmed = decodeUrlLikeValue(candidate);
	if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
		return null;
	}

	try {
		return new URL(trimmed, baseUrl).toString();
	} catch {
		return null;
	}
}

export function isTextLikeContentType(value: string | null): boolean {
	if (!value) {
		return false;
	}

	return (
		value.includes("json") ||
		value.includes("html") ||
		value.includes("text/") ||
		value.includes("javascript")
	);
}

export function normalizeHeaderValue(value: string | undefined): string | null {
	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}
	return value.toLowerCase();
}

export function compilePatterns(values: string[]): RegExp[] {
	return values.map((value) => new RegExp(value, "i"));
}

export function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(value));
}

function collectCandidateStrings(capture: DynamicShellNetworkCapture): string[] {
	const values = new Set<string>();
	values.add(capture.url);

	if (!capture.bodyText) {
		return [...values];
	}

	for (const value of extractUrlLikeStrings(capture.bodyText)) {
		values.add(value);
	}

	if (capture.contentType?.includes("json")) {
		for (const value of extractJsonStringValues(capture.bodyText)) {
			values.add(value);
		}
	}

	return [...values];
}

function extractJsonStringValues(raw: string): string[] {
	try {
		return [...walkJsonStringValues(JSON.parse(raw))];
	} catch {
		return [];
	}
}

function* walkJsonStringValues(value: unknown): Generator<string> {
	if (typeof value === "string") {
		yield value;
		const trimmed = value.trim();
		if (
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		) {
			try {
				yield* walkJsonStringValues(JSON.parse(trimmed));
			} catch {
				// Ignore nested string values that are not JSON payloads.
			}
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			yield* walkJsonStringValues(item);
		}
		return;
	}

	if (typeof value === "object" && value != null) {
		for (const item of Object.values(value)) {
			yield* walkJsonStringValues(item);
		}
	}
}

function extractUrlLikeStrings(value: string): string[] {
	const matches = value.match(/(https?:\/\/[^\s"'<>\\]+|\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/g);
	return matches ?? [];
}

function decodeUrlLikeValue(value: string): string {
	return value
		.trim()
		.replace(/\\\//g, "/")
		.replace(/\\u0026/gi, "&")
		.replace(/&amp;/gi, "&");
}
