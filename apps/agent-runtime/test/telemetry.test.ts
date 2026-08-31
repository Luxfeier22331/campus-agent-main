import { LangfuseSpanProcessor } from "@langfuse/otel";
import { context, SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	InMemorySpanExporter,
	type ReadableSpan,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrimaryAgentRuntime } from "../src/agent-run-contract.ts";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import { isAgentLangfuseSpan } from "../src/telemetry.ts";
import { createSafeSpanProcessor } from "../src/telemetry-sanitizer.ts";
import { testToolContractFingerprint } from "./helpers/runtime-contract.ts";

const agentScope = "@arizeai/openinference-instrumentation-openai-agents";
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [
		createSafeSpanProcessor(
			new LangfuseSpanProcessor({
				exporter,
				exportMode: "immediate",
				mediaUploadEnabled: false,
				shouldExportSpan: ({ otelSpan }) => isAgentLangfuseSpan(otelSpan),
			}),
		),
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

	it("keeps the Langfuse app-root marker on an exported Agent entry span", async () => {
		exporter.reset();
		const remoteParent = trace.setSpanContext(context.active(), {
			isRemote: true,
			spanId: "b".repeat(16),
			traceFlags: TraceFlags.SAMPLED,
			traceId: "a".repeat(32),
		});
		provider.getTracer(agentScope).startSpan("agent-entry", undefined, remoteParent).end();
		await provider.forceFlush();

		const [finished] = exporter.getFinishedSpans();
		expect(finished?.parentSpanContext?.isRemote).toBe(true);
		expect(finished?.attributes["langfuse.internal.is_app_root"]).toBe(true);
	});

	it("exports error status without exception text or stack traces", async () => {
		exporter.reset();
		const span = provider.getTracer(agentScope).startSpan("failed-agent-run");
		span.recordException(new Error("private provider response"));
		span.setStatus({ code: SpanStatusCode.ERROR, message: "private provider response" });
		span.end();
		await provider.forceFlush();

		const [finished] = exporter.getFinishedSpans();
		expect(finished?.status).toEqual({ code: SpanStatusCode.ERROR, message: "" });
		expect(finished?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/u);
		expect(finished?.events).toEqual([
			expect.objectContaining({
				attributes: expect.not.objectContaining({
					"exception.message": expect.anything(),
					"exception.stacktrace": expect.anything(),
				}),
				name: "exception",
			}),
		]);
		expect(JSON.stringify(finished)).not.toContain("private provider response");
	});

	it("drops every unregistered payload from the downstream snapshot", async () => {
		const captured: ReadableSpan[] = [];
		let endingCalls = 0;
		const delegate: SpanProcessor = {
			forceFlush: async () => undefined,
			onEnd: (span) => captured.push(span),
			onEnding: () => {
				endingCalls += 1;
			},
			onStart: () => undefined,
			shutdown: async () => undefined,
		};
		const localProvider = new NodeTracerProvider({
			resource: resourceFromAttributes(
				{
					"service.name": "test-service",
					"service.version": "0.1.0",
					"resource.secret": "resource-secret-sentinel",
				},
				{ schemaUrl: "https://user:secret@example.invalid/resource" },
			),
			spanProcessors: [createSafeSpanProcessor(delegate)],
		});
		const span = localProvider.getTracer(agentScope).startSpan("safe-agent-span");
		const sentinel = "private-payload-sentinel";
		span.setAttributes({
			"input.value": sentinel,
			"output.value": sentinel,
			"openinference.message.content": sentinel,
			"llm.tools": sentinel,
			"tool.arguments": sentinel,
			"tool.result": sentinel,
			"langfuse.observation.input": sentinel,
			"langfuse.observation.output": sentinel,
			"langfuse.internal.is_app_root": "true",
			"langfuse.internal.unregistered": true,
			activity_attempt: "2",
			workflow_id: "workflow-1",
			"unknown.secret": sentinel,
			"session.id": "session-1",
			"user.id": "user-1",
		});
		span.addEvent("custom", { "event.secret": sentinel });
		span.recordException(new Error(sentinel));
		span.setStatus({ code: SpanStatusCode.ERROR, message: sentinel });
		span.addLink({
			context: {
				traceId: "a".repeat(32),
				spanId: "b".repeat(16),
				traceFlags: 1,
				isRemote: true,
			},
			attributes: { "link.secret": sentinel },
		});
		span.end();
		const falseRootSpan = localProvider.getTracer(agentScope).startSpan("false-app-root");
		falseRootSpan.setAttribute("langfuse.internal.is_app_root", false);
		falseRootSpan.end();

		expect(endingCalls).toBe(0);
		const [sanitized, sanitizedFalseRoot] = captured;
		expect(sanitized).toBeDefined();
		expect(sanitized).not.toBe(span);
		expect(sanitized?.attributes).toMatchObject({
			"session.id": "session-1",
			"user.id": "user-1",
		});
		expect(sanitized?.attributes).not.toHaveProperty("input.value");
		expect(sanitized?.attributes).not.toHaveProperty("output.value");
		expect(sanitized?.attributes).not.toHaveProperty("openinference.message.content");
		expect(sanitized?.attributes).not.toHaveProperty("llm.tools");
		expect(sanitized?.attributes).not.toHaveProperty("tool.arguments");
		expect(sanitized?.attributes).not.toHaveProperty("tool.result");
		expect(sanitized?.attributes).not.toHaveProperty("langfuse.observation.input");
		expect(sanitized?.attributes).not.toHaveProperty("langfuse.observation.output");
		expect(sanitized?.attributes).not.toHaveProperty("langfuse.internal.is_app_root");
		expect(sanitized?.attributes).not.toHaveProperty("langfuse.internal.unregistered");
		expect(sanitized?.attributes).not.toHaveProperty("activity_attempt");
		expect(sanitized?.attributes).not.toHaveProperty("workflow_id");
		expect(sanitized?.attributes).not.toHaveProperty("unknown.secret");
		expect(sanitized?.events).toHaveLength(1);
		expect(sanitized?.events[0]).toEqual(
			expect.objectContaining({
				attributes: { "exception.type": "Error" },
				name: "exception",
			}),
		);
		expect(sanitized?.links).toEqual([]);
		expect(sanitized?.status).toEqual({ code: SpanStatusCode.ERROR, message: "" });
		expect(sanitized?.resource.attributes).not.toHaveProperty("resource.secret");
		expect(sanitized?.resource.schemaUrl).toBeUndefined();
		expect(JSON.stringify(sanitized)).not.toContain(sentinel);
		expect(sanitizedFalseRoot?.attributes).not.toHaveProperty("langfuse.internal.is_app_root");
		await localProvider.shutdown();
	});

	it("keeps only product correlation attributes active while a response stream is consumed", async () => {
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
						data: completedResult(input.requestId),
					};
				})();
			},
		};
		const handler = createAgentRuntimeHandler({
			modelConfig: {
				baseUrl: "http://model-config",
				fetchImplementation: async () =>
					Response.json({
						api_key: "test-key",
						api_protocol: "openai.responses",
						base_url: "https://api.openai.com/v1",
						model: "test-model",
						name: "primary_agent",
						provider: "openai",
						schema_version: "model_runtime_config.v1",
						target_sha256: "5b2e4a65688738d87e396008d0d331b53e13a9dc53a7c89c7391b0d5440b5b70",
					}),
			},
			runtime,
			runtimeRelease: "test-release",
			sharedSecret: "secret",
		});
		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests/stream", {
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
			"langfuse.trace.metadata.request_id": "request-1",
			"langfuse.trace.name": "online-answer",
			"langfuse.trace.tags": ["surface:agent-runtime"],
			"user.id": "user-1",
		});
		expect(span?.attributes).not.toHaveProperty("langfuse.trace.metadata.activity_attempt");
	});
});

function validRunBody() {
	return {
		activity_attempt: 2,
		conversation_id: "conversation-1",
		input: "你好",
		limits: {
			agent_deadline_ms: 10_000,
			context_char_limit: 16_000,
			current_input_char_limit: 4_000,
			max_output_tokens: 1_000,
			max_function_tool_calls: 0,
			max_turns: 1,
		},
		expected_model_target_sha256:
			"5b2e4a65688738d87e396008d0d331b53e13a9dc53a7c89c7391b0d5440b5b70",
		request_id: "request-1",
		user_id: "user-1",
		visible_function_tool_names: [],
		expected_tool_contract_fingerprint: {
			function_schema_sha256: testToolContractFingerprint().functionSchemaSha256,
			schema_version: testToolContractFingerprint().schemaVersion,
			tools_sha256: testToolContractFingerprint().toolsSha256,
		},
	};
}

function completedResult(requestId: string) {
	return {
		contextUsage: {
			contextChars: 44,
			currentInputChars: 2,
			modelVisibleItemCount: 1,
		},
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
		requestId,
		stageTiming: {},
		status: "completed" as const,
		terminalReason: "answer_completed" as const,
		toolResults: [],
		webCitations: [],
		webSearchUsed: false,
		toolContractFingerprint: testToolContractFingerprint(),
		usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
	};
}
