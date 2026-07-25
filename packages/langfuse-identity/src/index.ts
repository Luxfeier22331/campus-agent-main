import { createTraceId } from "@langfuse/tracing";

const LANGFUSE_TRACE_SALT = "campus-agent-langfuse-trace-v1";
const DEFAULT_SPAN_ID = "0000000000000001";

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
