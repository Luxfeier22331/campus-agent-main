import { OpenAIAgentsInstrumentation } from "@arizeai/openinference-instrumentation-openai-agents";
import * as agents from "@openai/agents";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
export function disableOpenAITracing() {
	agents.setTracingDisabled(true);
}
export function instrumentOpenAI(provider: NodeTracerProvider) {
	const instrumentation = new OpenAIAgentsInstrumentation({
		exclusiveProcessor: true,
		traceConfig: {
			hideInputs: true,
			hideOutputs: true,
		},
		tracerProvider: provider,
	});
	instrumentation.manuallyInstrument(agents, { exclusiveProcessor: true });
	return instrumentation;
}
