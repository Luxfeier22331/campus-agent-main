const LANGFUSE_TRACE_SALT = "campus-agent-langfuse-trace-v1";
const DEFAULT_SPAN_ID = "0000000000000001";

export function deriveLangfuseTraceId(productTraceId: string): string {
	const normalized = productTraceId.trim();
	if (!normalized) {
		throw new Error("Langfuse trace id derivation requires a non-empty product trace id");
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
		throw new Error("Langfuse trace id must be 32 lowercase hex characters");
	}
	return `00-${langfuseTraceId}-${DEFAULT_SPAN_ID}-01`;
}
