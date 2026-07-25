import {
	deriveLangfuseTraceId,
	traceParentForLangfuseTraceId,
} from "@campus-agent/langfuse-identity";

export {
	deriveLangfuseTraceId,
	traceParentForLangfuseTraceId,
} from "@campus-agent/langfuse-identity";

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

export async function ensureLangfuseTraceParent(
	productTraceId: string,
): Promise<TracePropagationHeaders> {
	return {
		traceParent: traceParentForLangfuseTraceId(await deriveLangfuseTraceId(productTraceId)),
	};
}
