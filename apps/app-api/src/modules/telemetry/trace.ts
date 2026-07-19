import { createTraceId } from "@langfuse/tracing";

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

export async function deriveLangfuseTraceId(productTraceId: string): Promise<string> {
	const normalized = productTraceId.trim();
	if (!normalized) {
		throw new Error("Langfuse trace id derivation requires a non-empty product trace id.");
	}
	return createTraceId(`${LANGFUSE_TRACE_SALT}:${normalized}`);
}

export function traceParentForLangfuseTraceId(langfuseTraceId: string): string {
	if (!/^[0-9a-f]{32}$/u.test(langfuseTraceId)) {
		throw new Error("Langfuse trace id must be 32 lowercase hex characters.");
	}
	return `00-${langfuseTraceId}-${DEFAULT_SPAN_ID}-01`;
}

export async function ensureLangfuseTraceParent(
	productTraceId: string,
): Promise<TracePropagationHeaders> {
	return {
		traceParent: traceParentForLangfuseTraceId(await deriveLangfuseTraceId(productTraceId)),
	};
}
