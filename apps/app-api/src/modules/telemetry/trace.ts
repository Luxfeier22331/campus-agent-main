import {
	deriveLangfuseTraceId,
	traceParentForLangfuseTraceId,
} from "@campus-agent/langfuse-identity";

export {
	deriveLangfuseTraceId,
	traceParentForLangfuseTraceId,
} from "@campus-agent/langfuse-identity";

export interface TracePropagationHeaders {
	traceParent?: string | null;
}

const W3C_TRACE_PARENT_V00_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[0-3])$/u;

function isValidTraceParent(value: string): boolean {
	const match = W3C_TRACE_PARENT_V00_PATTERN.exec(value);
	return match !== null && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]);
}

export function applyTracePropagationHeaders(
	headers: Headers,
	traceHeaders: TracePropagationHeaders,
): void {
	const traceParent = traceHeaders.traceParent?.trim();
	if (traceParent && isValidTraceParent(traceParent)) {
		headers.set("traceparent", traceParent);
	}
}

export async function ensureLangfuseTraceParent(
	productTraceId: string,
): Promise<TracePropagationHeaders> {
	return {
		traceParent: traceParentForLangfuseTraceId(await deriveLangfuseTraceId(productTraceId)),
	};
}
