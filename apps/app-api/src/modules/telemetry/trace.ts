export interface TracePropagationHeaders {
	baggage?: string | null;
	sentryTrace?: string | null;
	traceParent?: string | null;
}

export interface TraceDataLike {
	baggage?: unknown;
	"sentry-trace"?: unknown;
	traceparent?: unknown;
}

const LANGFUSE_TRACE_SALT = "campus-agent-langfuse-trace-v1";
const DEFAULT_SPAN_ID = "0000000000000001";

function toHeaders(input?: Headers | Request | null): Headers | null {
	if (!input) {
		return null;
	}

	if (input instanceof Request) {
		return input.headers;
	}

	return input;
}

function toTrimmedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveTracePropagationHeaders(
	input: { request?: Headers | Request | null; traceData?: TraceDataLike | null } = {},
): TracePropagationHeaders {
	const headers = toHeaders(input.request);
	const sentryTrace =
		toTrimmedString(headers?.get("sentry-trace")) ??
		toTrimmedString(input.traceData?.["sentry-trace"]);
	const baggage =
		toTrimmedString(headers?.get("baggage")) ?? toTrimmedString(input.traceData?.baggage);
	const traceParent =
		toTrimmedString(headers?.get("traceparent")) ?? toTrimmedString(input.traceData?.traceparent);

	return {
		baggage,
		sentryTrace,
		traceParent,
	};
}

export function applyTracePropagationHeaders(
	headers: Headers,
	traceHeaders: TracePropagationHeaders,
): void {
	if (traceHeaders.sentryTrace) {
		headers.set("sentry-trace", traceHeaders.sentryTrace);
	}

	if (traceHeaders.traceParent) {
		headers.set("traceparent", traceHeaders.traceParent);
	}

	if (traceHeaders.baggage) {
		headers.set("baggage", traceHeaders.baggage);
	}
}

export function deriveLangfuseTraceId(productTraceId: string): string {
	const normalized = productTraceId.trim();
	if (!normalized) {
		throw new Error("Langfuse trace id derivation requires a non-empty product trace id.");
	}
	const seed = `${LANGFUSE_TRACE_SALT}:${normalized}`;
	let hash = 0x811c9dc5;
	let output = "";
	for (let index = 0; output.length < 32; index += 1) {
		for (let offset = 0; offset < seed.length; offset += 1) {
			hash ^= seed.charCodeAt(offset) + index;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		output += hash.toString(16).padStart(8, "0");
	}
	return output.slice(0, 32);
}

export function traceParentForLangfuseTraceId(langfuseTraceId: string): string {
	if (!/^[0-9a-f]{32}$/u.test(langfuseTraceId)) {
		throw new Error("Langfuse trace id must be 32 lowercase hex characters.");
	}
	return `00-${langfuseTraceId}-${DEFAULT_SPAN_ID}-01`;
}

export function ensureLangfuseTraceParent(
	traceHeaders: TracePropagationHeaders | undefined | null,
	productTraceId: string,
): TracePropagationHeaders {
	const existing = traceHeaders ?? {};
	return {
		...existing,
		traceParent: traceParentForLangfuseTraceId(deriveLangfuseTraceId(productTraceId)),
	};
}
