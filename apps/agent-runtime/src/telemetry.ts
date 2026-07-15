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
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from "@opentelemetry/semantic-conventions";

export interface AgentTelemetryController {
	configured: boolean;
	shutdown(): Promise<void>;
}

let activeTelemetry: AgentTelemetryController | undefined;

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
	const processor = new LangfuseSpanProcessor({
		environment: env.LANGFUSE_TRACING_ENVIRONMENT ?? env.DEPLOYMENT_ENVIRONMENT,
		exporter,
		mediaUploadEnabled: false,
		release: env.LANGFUSE_RELEASE ?? env.DEPLOYMENT_RELEASE,
	});
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
