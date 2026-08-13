import { OpenAIAgentsInstrumentation } from "@arizeai/openinference-instrumentation-openai-agents";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import * as agents from "@openai/agents";
import {
	context,
	propagation,
	ROOT_CONTEXT,
	type TextMapGetter,
	type TextMapSetter,
} from "@opentelemetry/api";
import {
	CompositePropagator,
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from "@opentelemetry/semantic-conventions";
import { createSafeSpanProcessor } from "./telemetry-sanitizer.ts";

export interface AgentTelemetryController {
	configured: boolean;
	shutdown(): Promise<void>;
}

let activeTelemetry: AgentTelemetryController | undefined;

const OPENAI_AGENTS_INSTRUMENTATION_SCOPE = "@arizeai/openinference-instrumentation-openai-agents";

export function startAgentRuntimeTelemetry(
	env: NodeJS.ProcessEnv = process.env,
): AgentTelemetryController {
	if (activeTelemetry) {
		return activeTelemetry;
	}
	if (!(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
		activeTelemetry = noopTelemetryController();
		return activeTelemetry;
	}

	const exporter = new OTLPTraceExporter();
	const langfuseProcessor = new LangfuseSpanProcessor({
		...(env.DEPLOYMENT_ENVIRONMENT === undefined
			? {}
			: { environment: env.DEPLOYMENT_ENVIRONMENT }),
		exporter,
		mediaUploadEnabled: false,
		...(env.DEPLOYMENT_RELEASE === undefined ? {} : { release: env.DEPLOYMENT_RELEASE }),
		shouldExportSpan: ({ otelSpan }) => isAgentLangfuseSpan(otelSpan),
	});
	const processor = createSafeSpanProcessor(langfuseProcessor);
	const provider = new NodeTracerProvider({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME?.trim() || "agent-runtime",
			[ATTR_SERVICE_NAMESPACE]: "campus-agent",
		}),
		spanProcessors: [processor],
	});
	provider.register({
		propagator: new CompositePropagator({
			propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
		}),
	});
	const instrumentation = new OpenAIAgentsInstrumentation({
		exclusiveProcessor: true,
		traceConfig: {
			hideInputs: true,
			hideOutputs: true,
		},
		tracerProvider: provider,
	});
	instrumentation.manuallyInstrument(agents, { exclusiveProcessor: true });

	activeTelemetry = {
		configured: true,
		async shutdown() {
			instrumentation.uninstrument();
			await provider.shutdown();
		},
	};
	return activeTelemetry;
}

export function runWithExtractedTraceContext<T>(headers: Headers, callback: () => T): T {
	const extracted = propagation.extract(ROOT_CONTEXT, headers, headersGetter);
	return context.with(extracted, callback);
}

export function injectTraceContext(headers: Headers): Headers {
	propagation.inject(context.active(), headers, headersSetter);
	return headers;
}

export function bindAsyncIterableToActiveContext<T>(iterable: AsyncIterable<T>): AsyncIterable<T> {
	const boundContext = context.active();
	return {
		async *[Symbol.asyncIterator]() {
			const iterator = iterable[Symbol.asyncIterator]();
			try {
				for (;;) {
					const item = await context.with(boundContext, () => iterator.next());
					if (item.done) {
						return;
					}
					yield item.value;
				}
			} finally {
				if (iterator.return) {
					await context.with(boundContext, () => iterator.return?.());
				}
			}
		},
	};
}

export function isAgentLangfuseSpan(
	span: Pick<ReadableSpan, "attributes" | "instrumentationScope">,
) {
	const scope = span.instrumentationScope.name;
	return (
		scope === OPENAI_AGENTS_INSTRUMENTATION_SCOPE ||
		scope === "@langfuse/tracing" ||
		scope === "openinference" ||
		scope.startsWith("openinference.") ||
		Object.keys(span.attributes).some((key) => key.startsWith("gen_ai."))
	);
}

function noopTelemetryController(): AgentTelemetryController {
	return {
		configured: false,
		shutdown: async () => undefined,
	};
}

const headersGetter: TextMapGetter<Headers> = {
	get(carrier, key) {
		return carrier.get(key) ?? undefined;
	},
	keys(carrier) {
		return [...carrier.keys()];
	},
};

const headersSetter: TextMapSetter<Headers> = {
	set(carrier, key, value) {
		carrier.set(key, value);
	},
};
