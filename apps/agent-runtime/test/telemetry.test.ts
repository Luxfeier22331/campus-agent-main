import { LangfuseSpanProcessor } from "@langfuse/otel";
import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import type { PrimaryAgentRuntime } from "../src/primary-agent.ts";
import { isAgentLangfuseSpan } from "../src/telemetry.ts";
import { testToolRuntimeFingerprint } from "./helpers/runtime-fingerprint.ts";

const agentScope = "@arizeai/openinference-instrumentation-openai-agents";
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [
		new LangfuseSpanProcessor({
			exporter,
			exportMode: "immediate",
			mediaUploadEnabled: false,
			shouldExportSpan: ({ otelSpan }) => isAgentLangfuseSpan(otelSpan),
		}),
	],
});

beforeAll(() => {
	provider.register();
});

afterAll(async () => {
	await provider.shutdown();
	context.disable();
	trace.disable();
});

describe("agent runtime Langfuse telemetry", () => {
	it("exports the Arize OpenInference scope and rejects unrelated spans", async () => {
		exporter.reset();
		provider.getTracer(agentScope).startSpan("agent-run").end();
		provider.getTracer("unrelated-http-client").startSpan("http-call").end();
		await provider.forceFlush();

		expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["agent-run"]);
	});

	it("keeps trusted Langfuse attributes active while a response stream is consumed", async () => {
		exporter.reset();
		const runtime: PrimaryAgentRuntime = {
			async run() {
				throw new Error("blocking runtime is not expected");
			},
			stream(input) {
				return (async function* () {
					provider.getTracer(agentScope).startSpan("stream-model-call").end();
					yield {
						event: "completed" as const,
						data: completedResult(input.runId),
					};
				})();
			},
		};
		const handler = createAgentRuntimeHandler({ runtime, sharedSecret: "secret" });
		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs/stream", {
				body: JSON.stringify(validRunBody()),
				headers: { authorization: "Bearer secret" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await response.text();
		await provider.forceFlush();
		const [span] = exporter.getFinishedSpans();
		expect(span?.attributes).toMatchObject({
			"session.id": "conversation-1",
			"langfuse.trace.metadata.activity_attempt": "2",
			"langfuse.trace.metadata.request_id": "request-1",
			"langfuse.trace.metadata.run_id": "run-1",
			"langfuse.trace.metadata.trace_id": "trace-1",
			"langfuse.trace.metadata.turn_id": "turn-1",
			"langfuse.trace.name": "online-answer",
			"langfuse.trace.tags": ["surface:agent-runtime"],
			"user.id": "user-1",
		});
	});
});

function validRunBody() {
	return {
		activity_attempt: 2,
		allow_ungrounded_answer: true,
		conversation_id: "conversation-1",
		grounding_context: {
			admission_sha256: `sha256:${"1".repeat(64)}`,
			covered_scopes: [],
			evidence: [],
			mode: "none",
			model_context_chars: 39,
			plan_sha256: "3".repeat(64),
			prepared_at: "2026-07-26T08:00:00.000Z",
			query_sha256: `sha256:${"2".repeat(64)}`,
			run_id: "run-1",
			schema_version: "grounding_context.v2",
			selected_scopes: [],
			status: "not_required",
			token_count: 0,
		},
		input: "你好",
		limits: {
			agent_deadline_ms: 10_000,
			context_char_limit: 16_000,
			current_input_char_limit: 4_000,
			max_output_tokens: 1_000,
			max_tool_calls: 0,
			max_turns: 1,
		},
		provider_config: {
			api_key: "test-key",
			model: "test-model",
			provider: "openai",
			transport: "responses",
		},
		request_id: "request-1",
		run_id: "run-1",
		trace_id: "trace-1",
		turn_id: "turn-1",
		user_id: "user-1",
		visible_tool_names: [],
		expected_tool_runtime_fingerprint: {
			combined_sha256: testToolRuntimeFingerprint().combinedSha256,
			function_schema_sha256: testToolRuntimeFingerprint().functionSchemaSha256,
			function_schema_version: testToolRuntimeFingerprint().functionSchemaVersion,
			runtime_release: testToolRuntimeFingerprint().runtimeRelease,
			schema_version: testToolRuntimeFingerprint().schemaVersion,
			tools_registry_version: testToolRuntimeFingerprint().toolsRegistryVersion,
			tools_schema_version: testToolRuntimeFingerprint().toolsSchemaVersion,
			tools_sha256: testToolRuntimeFingerprint().toolsSha256,
		},
	};
}

function completedResult(runId: string) {
	return {
		finalOutput: "你好",
		modelName: "test-model",
		modelProvider: "openai",
		promptTrace: {
			promptId: "primary_agent" as const,
			promptTemplateSha256: "sha256:template",
			renderedPromptSha256: "sha256:rendered",
			schemaVersion: "agent_runtime_prompt_trace.v1" as const,
		},
		providerResponseId: "response-1",
		runId,
		stageTiming: {},
		status: "completed" as const,
		terminalReason: "answer_completed" as const,
		toolResults: [],
		toolRuntimeFingerprint: testToolRuntimeFingerprint(),
		usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
	};
}
