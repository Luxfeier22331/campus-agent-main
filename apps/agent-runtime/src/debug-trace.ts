import {
	addTraceProcessor,
	type Span,
	type SpanData,
	type Trace,
	type TracingProcessor,
} from "@openai/agents";

export type LlmDebugTraceMode = "off" | "langfuse_otlp";
export type RawCapturePolicyMode =
	| "eval_case"
	| "failure_triggered"
	| "manual_run_capture"
	| "off"
	| "operator_window"
	| "sampled";
export type RawCaptureSink = "langfuse_otlp" | "openai_agents_trace" | "s3_replay_packet";
export type RawCaptureField =
	| "output_schema"
	| "provider_request_body"
	| "provider_response_body"
	| "provider_stream_deltas"
	| "rendered_messages"
	| "selected_evidence_packet"
	| "selected_memory_context"
	| "tool_calls"
	| "tool_results";

export interface RawCapturePolicy {
	allowed_raw_fields: RawCaptureField[];
	allowed_sinks: RawCaptureSink[];
	approval_ref: string | null;
	audit_required: boolean;
	capture_reason: string;
	dsar_delete_linkage_required: boolean;
	mode: RawCapturePolicyMode;
	operator_principal: string | null;
	request_id: string | null;
	run_id: string | null;
	schema_version: "raw_capture_policy.v1";
	ttl_days: number;
	trace_id: string | null;
}

export interface LlmDebugTraceConfig {
	includeModelIo: boolean;
	langfuseOtlp?: {
		authHeader: string;
		endpoint: string;
		publicTraceBaseUrl?: string;
	};
	mode: LlmDebugTraceMode;
	rawCapturePolicy?: RawCapturePolicy;
	sampleRatio: number;
	schemaVersion: "llm_debug_trace_config.v1";
}

export interface DebugTraceRef {
	sink: "langfuse_otlp";
	traceId: string;
	traceRef: string;
	url?: string;
}

interface DebugTraceState {
	config: LlmDebugTraceConfig;
	errors: Error[];
	exportedItemCount: number;
	fetchImplementation: typeof fetch;
	langfuseTraceId: string;
	pending: Promise<void>[];
	rawTraceId: string;
}

export interface DebugTraceController {
	refs: DebugTraceRef[];
	exportSummary(input: {
		model?: string;
		provider?: string;
		runId: string;
		status: "completed" | "failed";
	}): void;
	flush(): Promise<void>;
	close(): void;
}

const TRACE_SALT = "campus-agent-langfuse-trace-v1";
const OTLP_SCOPE_NAME = "campus-agent.agent-runtime.llm-debug-trace";
const activeStates = new Map<string, DebugTraceState>();
let processorRegistered = false;

export function beginDebugTrace(input: {
	config?: LlmDebugTraceConfig;
	fetchImplementation?: typeof fetch;
	traceId: string;
}): DebugTraceController {
	ensureTraceProcessor();
	const rawTraceId = input.traceId.trim();
	const refs = debugTraceRefsForConfig(input.config, rawTraceId);
	if (refs.length === 0 || !input.config || input.config.mode === "off") {
		return noopDebugTraceController(refs);
	}
	if (activeStates.has(rawTraceId)) {
		throw new Error("duplicate active LLM debug trace id");
	}
	const state: DebugTraceState = {
		config: input.config,
		errors: [],
		exportedItemCount: 0,
		fetchImplementation: input.fetchImplementation ?? fetch,
		langfuseTraceId: refs[0]?.traceId ?? deriveLangfuseTraceId(rawTraceId),
		pending: [],
		rawTraceId,
	};
	activeStates.set(rawTraceId, state);
	return {
		refs,
		exportSummary(summary) {
			if (state.exportedItemCount > 0) {
				return;
			}
			queueExport(state, [
				{
					attributes: {
						"agent_runtime.trace_mode": state.config.mode,
						"gen_ai.request.model": summary.model ?? "",
						"gen_ai.system": summary.provider ?? "",
						"langfuse.observation.type": "span",
						"langfuse.trace.name": "campus-agent.primary-agent",
						"run.id": summary.runId,
					},
					name: "agent-runtime.primary-agent",
					spanId: spanIdFromString(`${state.rawTraceId}:agent-runtime.primary-agent`),
					status: summary.status,
				},
			]);
		},
		async flush() {
			while (state.pending.length > 0) {
				const pending = state.pending.splice(0);
				await Promise.allSettled(pending);
			}
			if (state.errors.length > 0) {
				throw state.errors[0];
			}
		},
		close() {
			activeStates.delete(rawTraceId);
		},
	};
}

export function debugTraceRefsForConfig(
	config: LlmDebugTraceConfig | undefined,
	rawTraceId: string,
): DebugTraceRef[] {
	if (!config || config.mode === "off" || !isSampled(rawTraceId, config.sampleRatio)) {
		return [];
	}
	const langfuseTraceId = deriveLangfuseTraceId(rawTraceId);
	const ref: DebugTraceRef = {
		sink: "langfuse_otlp",
		traceId: langfuseTraceId,
		traceRef: `langfuse://${langfuseTraceId}`,
	};
	const baseUrl = config.langfuseOtlp?.publicTraceBaseUrl?.trim().replace(/\/+$/u, "");
	if (baseUrl) {
		ref.url = `${baseUrl}/${langfuseTraceId}`;
	}
	return [ref];
}

function noopDebugTraceController(refs: DebugTraceRef[]): DebugTraceController {
	return {
		refs,
		close: () => undefined,
		exportSummary: () => undefined,
		flush: async () => undefined,
	};
}

function ensureTraceProcessor(): void {
	if (processorRegistered) {
		return;
	}
	addTraceProcessor(new RequestScopedDebugTraceProcessor());
	processorRegistered = true;
}

class RequestScopedDebugTraceProcessor implements TracingProcessor {
	async onTraceStart(trace: Trace): Promise<void> {
		const state = activeStates.get(trace.traceId);
		if (!state) {
			return;
		}
		queueExport(state, [
			{
				attributes: {
					"agent_runtime.trace_mode": state.config.mode,
					"langfuse.observation.type": "span",
					"langfuse.trace.name": trace.name,
				},
				name: trace.name || "campus-agent.primary-agent",
				spanId: spanIdFromString(`${trace.traceId}:trace-root`),
				status: "completed",
			},
		]);
	}

	async onTraceEnd(_trace: Trace): Promise<void> {
		return;
	}

	async onSpanStart(_span: Span<SpanData>): Promise<void> {
		return;
	}

	async onSpanEnd(span: Span<SpanData>): Promise<void> {
		const state = activeStates.get(span.traceId);
		if (!state) {
			return;
		}
		queueExport(state, [spanToOtlpSpanInput(span)]);
	}

	async shutdown(): Promise<void> {
		return;
	}

	async forceFlush(): Promise<void> {
		return;
	}
}

interface OtlpSpanInput {
	attributes: Record<string, string | number | boolean>;
	endedAt?: string | null;
	name: string;
	parentSpanId?: string | null;
	spanId: string;
	startedAt?: string | null;
	status: "completed" | "failed";
	statusMessage?: string;
}

function spanToOtlpSpanInput(span: Span<SpanData>): OtlpSpanInput {
	const safeData = safeSpanData(span.spanData);
	return {
		attributes: safeData.attributes,
		endedAt: span.endedAt,
		name: safeData.name,
		parentSpanId: span.parentId,
		spanId: normalizeSpanId(span.spanId),
		startedAt: span.startedAt,
		status: span.error ? "failed" : "completed",
		statusMessage: span.error?.message,
	};
}

function safeSpanData(data: SpanData): {
	attributes: Record<string, string | number | boolean>;
	name: string;
} {
	switch (data.type) {
		case "agent":
			return {
				attributes: {
					"agent.name": data.name,
					"agent.output_type": data.output_type ?? "",
					"agent.tools": data.tools?.join(",") ?? "",
					"langfuse.observation.type": "span",
				},
				name: `agent:${data.name}`,
			};
		case "generation":
			return {
				attributes: {
					"gen_ai.request.model": data.model ?? "",
					"gen_ai.usage.input_tokens": numberOrZero(data.usage?.input_tokens),
					"gen_ai.usage.output_tokens": numberOrZero(data.usage?.output_tokens),
					"langfuse.observation.type": "generation",
				},
				name: "generation",
			};
		case "response":
			return {
				attributes: {
					"gen_ai.response.id": data.response_id ?? "",
					"langfuse.observation.type": "span",
				},
				name: "response",
			};
		case "function":
			return {
				attributes: {
					"function.name": data.name,
					"langfuse.observation.type": "span",
				},
				name: `function:${data.name}`,
			};
		case "guardrail":
			return {
				attributes: {
					"guardrail.name": data.name,
					"guardrail.triggered": data.triggered,
					"langfuse.observation.type": "span",
				},
				name: `guardrail:${data.name}`,
			};
		default:
			return {
				attributes: {
					"langfuse.observation.type": "span",
					"span.type": data.type,
				},
				name: data.type,
			};
	}
}

function queueExport(state: DebugTraceState, spans: OtlpSpanInput[]): void {
	state.exportedItemCount += spans.length;
	const promise = postOtlpSpans(state, spans).catch((error) => {
		const normalized = error instanceof Error ? error : new Error(String(error));
		state.errors.push(normalized);
		throw normalized;
	});
	state.pending.push(promise);
}

async function postOtlpSpans(state: DebugTraceState, spans: OtlpSpanInput[]): Promise<void> {
	const endpoint = state.config.langfuseOtlp?.endpoint.trim().replace(/\/+$/u, "");
	const authHeader = state.config.langfuseOtlp?.authHeader.trim();
	if (!(endpoint && authHeader)) {
		throw new Error("LLM debug trace langfuse_otlp config is incomplete");
	}
	const response = await state.fetchImplementation(`${endpoint}/v1/traces`, {
		body: JSON.stringify({
			resourceSpans: [
				{
					resource: {
						attributes: toOtlpAttributes({
							"service.name": "agent-runtime",
							"service.namespace": "campus-agent",
						}),
					},
					scopeSpans: [
						{
							scope: { name: OTLP_SCOPE_NAME },
							spans: spans.map((span) => otlpSpan(state, span)),
						},
					],
				},
			],
		}),
		headers: {
			authorization: authHeader,
			"content-type": "application/json",
			"x-langfuse-ingestion-version": "4",
		},
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`LLM debug trace OTLP export failed with HTTP ${response.status}`);
	}
}

function otlpSpan(state: DebugTraceState, span: OtlpSpanInput) {
	const startedAt = span.startedAt ?? new Date().toISOString();
	const endedAt = span.endedAt ?? startedAt;
	return {
		attributes: toOtlpAttributes(span.attributes),
		endTimeUnixNano: unixNano(endedAt),
		kind: 1,
		name: span.name,
		parentSpanId: span.parentSpanId ? normalizeSpanId(span.parentSpanId) : undefined,
		spanId: normalizeSpanId(span.spanId),
		startTimeUnixNano: unixNano(startedAt),
		status: {
			code: span.status === "failed" ? 2 : 1,
			message: span.statusMessage,
		},
		traceId: state.langfuseTraceId,
	};
}

function toOtlpAttributes(input: Record<string, string | number | boolean>) {
	return Object.entries(input)
		.filter((entry): entry is [string, string | number | boolean] => entry[1] !== "")
		.map(([key, value]) => {
			if (typeof value === "boolean") {
				return { key, value: { boolValue: value } };
			}
			if (typeof value === "number") {
				return Number.isInteger(value)
					? { key, value: { intValue: String(value) } }
					: { key, value: { doubleValue: value } };
			}
			return { key, value: { stringValue: value } };
		});
}

function unixNano(value: string): string {
	const millis = Date.parse(value);
	return String(BigInt(Number.isFinite(millis) ? millis : Date.now()) * 1_000_000n);
}

export function deriveLangfuseTraceId(productTraceId: string): string {
	const normalized = productTraceId.trim();
	if (!normalized) {
		throw new Error("Langfuse trace id derivation requires a non-empty product trace id");
	}
	const seed = `${TRACE_SALT}:${normalized}`;
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

function isSampled(traceId: string, sampleRatio: number): boolean {
	if (sampleRatio <= 0) {
		return false;
	}
	if (sampleRatio >= 1) {
		return true;
	}
	const bucket = Number.parseInt(deriveLangfuseTraceId(traceId).slice(0, 8), 16) / 0xffffffff;
	return bucket <= sampleRatio;
}

function spanIdFromString(value: string): string {
	return deriveLangfuseTraceId(value).slice(0, 16);
}

function normalizeSpanId(value: string): string {
	return /^[0-9a-f]{16}$/u.test(value) ? value : spanIdFromString(value);
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
