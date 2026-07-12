import {
	type Span as AgentsSpan,
	type Trace as AgentsTrace,
	type SpanData,
	setTraceProcessors,
	type TracingProcessor,
} from "@openai/agents";
import {
	type Attributes,
	context,
	type Span as OpenTelemetrySpan,
	trace as otelTrace,
	propagation,
	ROOT_CONTEXT,
	SpanStatusCode,
	type Tracer,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from "@opentelemetry/semantic-conventions";

const instrumentationName = "campus-agent.agent-runtime";

let telemetrySDK: NodeSDK | undefined;

export function startAgentRuntimeTelemetry(): NodeSDK {
	if (telemetrySDK) {
		return telemetrySDK;
	}
	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || "agent-runtime",
			[ATTR_SERVICE_NAMESPACE]: "campus-agent",
		}),
		traceExporter: new OTLPTraceExporter(),
	});
	sdk.start();
	setTraceProcessors([new AgentsOpenTelemetryProcessor(otelTrace.getTracer(instrumentationName))]);
	telemetrySDK = sdk;
	return sdk;
}

export function runWithExtractedTraceContext<T>(headers: Headers, callback: () => T): T {
	const carrier = Object.fromEntries(headers.entries());
	const extracted = propagation.extract(ROOT_CONTEXT, carrier);
	return context.with(extracted, callback);
}

export class AgentsOpenTelemetryProcessor implements TracingProcessor {
	private readonly traceSpans = new Map<string, OpenTelemetrySpan>();
	private readonly spans = new Map<string, { span: OpenTelemetrySpan; traceId: string }>();
	private readonly tracer: Tracer;

	constructor(tracer: Tracer) {
		this.tracer = tracer;
	}

	async onTraceStart(agentTrace: AgentsTrace): Promise<void> {
		const span = this.tracer.startSpan(
			agentTrace.name || "openai.agents.run",
			{
				attributes: safeTraceAttributes(agentTrace),
			},
			context.active(),
		);
		this.traceSpans.set(agentTrace.traceId, span);
	}

	async onTraceEnd(agentTrace: AgentsTrace): Promise<void> {
		for (const [spanId, value] of this.spans) {
			if (value.traceId === agentTrace.traceId) {
				value.span.end();
				this.spans.delete(spanId);
			}
		}
		this.traceSpans.get(agentTrace.traceId)?.end();
		this.traceSpans.delete(agentTrace.traceId);
	}

	async onSpanStart(agentSpan: AgentsSpan<SpanData>): Promise<void> {
		if (this.spans.has(agentSpan.spanId)) {
			return;
		}
		const parent = agentSpan.parentId
			? this.spans.get(agentSpan.parentId)?.span
			: this.traceSpans.get(agentSpan.traceId);
		const parentContext = parent ? otelTrace.setSpan(context.active(), parent) : context.active();
		const projection = safeSpanProjection(agentSpan.spanData);
		const span = this.tracer.startSpan(
			projection.name,
			{
				attributes: projection.attributes,
				startTime: dateFromISOString(agentSpan.startedAt),
			},
			parentContext,
		);
		this.spans.set(agentSpan.spanId, { span, traceId: agentSpan.traceId });
	}

	async onSpanEnd(agentSpan: AgentsSpan<SpanData>): Promise<void> {
		await this.onSpanStart(agentSpan);
		const active = this.spans.get(agentSpan.spanId)?.span;
		if (!active) {
			return;
		}
		active.setStatus({
			code: agentSpan.error ? SpanStatusCode.ERROR : SpanStatusCode.OK,
		});
		active.end(dateFromISOString(agentSpan.endedAt));
		this.spans.delete(agentSpan.spanId);
	}

	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}

function safeTraceAttributes(agentTrace: AgentsTrace): Attributes {
	const attributes: Attributes = {
		"openai.agents.trace_id": agentTrace.traceId,
	};
	for (const key of ["campus.trace_id", "request.id", "run.id"] as const) {
		const value = agentTrace.metadata?.[key];
		if (typeof value === "string" && value.trim()) {
			attributes[key] = value;
		}
	}
	return attributes;
}

export function safeSpanProjection(data: SpanData): {
	attributes: Attributes;
	name: string;
} {
	switch (data.type) {
		case "agent":
			return {
				attributes: {
					"gen_ai.agent.name": data.name,
					"openai.agents.tool_count": data.tools?.length ?? 0,
				},
				name: `agent:${data.name}`,
			};
		case "generation":
			return {
				attributes: {
					"gen_ai.operation.name": "chat",
					"gen_ai.request.model": data.model ?? "",
					"gen_ai.usage.input_tokens": finiteNumber(data.usage?.input_tokens),
					"gen_ai.usage.output_tokens": finiteNumber(data.usage?.output_tokens),
				},
				name: "generation",
			};
		case "response":
			return {
				attributes: { "gen_ai.response.id": data.response_id ?? "" },
				name: "response",
			};
		case "function":
			return {
				attributes: { "gen_ai.tool.name": data.name },
				name: `function:${data.name}`,
			};
		case "handoff":
			return {
				attributes: {
					"openai.agents.handoff.from": data.from_agent ?? "",
					"openai.agents.handoff.to": data.to_agent ?? "",
				},
				name: "handoff",
			};
		case "guardrail":
			return {
				attributes: {
					"openai.agents.guardrail.name": data.name,
					"openai.agents.guardrail.triggered": data.triggered,
				},
				name: `guardrail:${data.name}`,
			};
		case "transcription":
			return {
				attributes: { "gen_ai.request.model": data.model ?? "" },
				name: "transcription",
			};
		case "speech":
			return {
				attributes: { "gen_ai.request.model": data.model ?? "" },
				name: "speech",
			};
		case "custom":
			return { attributes: {}, name: `custom:${data.name}` };
		default:
			return { attributes: {}, name: data.type };
	}
}

function dateFromISOString(value: string | null): Date | undefined {
	if (!value) {
		return;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function finiteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
