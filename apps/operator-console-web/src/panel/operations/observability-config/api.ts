import { fetchJson } from "../../http";
import type { LlmDebugTraceConfigSummary, LlmDebugTraceConfigUpdatePayload } from "./model";

const LLM_DEBUG_TRACE_CONFIG_PATH = "/api/operator/observability-config/llm-debug-trace";

export function getLlmDebugTraceConfig(input: { signal?: AbortSignal } = {}) {
	return fetchJson<{ config: LlmDebugTraceConfigSummary }>(LLM_DEBUG_TRACE_CONFIG_PATH, {
		signal: input.signal,
	});
}

export function updateLlmDebugTraceConfig(payload: LlmDebugTraceConfigUpdatePayload) {
	return fetchJson<{ config: LlmDebugTraceConfigSummary }>(LLM_DEBUG_TRACE_CONFIG_PATH, {
		json: payload,
		method: "PATCH",
	});
}
