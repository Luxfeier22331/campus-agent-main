import { once } from "node:events";
import { setTracingDisabled } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import { createAgentRuntimeNodeServer } from "../src/node-http.ts";
import { createOpenAIAgentsRunner, createStreamingOpenAIAgentsRunner } from "../src/sdk-runner.ts";
import { createWorkflowOperationRuntime } from "../src/workflow-runtime.ts";
import { deferred } from "./helpers/deferred.ts";
import { delayedCancellationModel } from "./helpers/delayed-cancellation-model.ts";
import { testToolContractFingerprint } from "./helpers/runtime-contract.ts";

describe("real HTTP deadline through the installed SDK", () => {
	it.each([false, true])("responds before model cleanup, streaming=%s", async (stream) => {
		setTracingDisabled(true);
		const cleanup = deferred<void>();
		const modelStarted = vi.fn();
		const modelAborted = vi.fn();
		const errorLog = vi.fn();
		const model = delayedCancellationModel({
			afterAbort: () => cleanup.promise,
			onStart: modelStarted,
			onAbort: modelAborted,
		});
		const provider = {
			async getModel() {
				return model;
			},
		};
		const fingerprint = testToolContractFingerprint();
		const target = "a".repeat(64);
		const runtime = createWorkflowOperationRuntime({
			catalog: {
				contractFingerprint: fingerprint,
				registryVersion: "test",
				schemaVersion: "tool-registry-v7",
				tools: [],
			},
			runner: createOpenAIAgentsRunner({ model: "controlled", modelProvider: provider }),
			streamingRunner: createStreamingOpenAIAgentsRunner({
				model: "controlled",
				modelProvider: provider,
			}),
		});
		const server = createAgentRuntimeNodeServer({
			sharedSecret: "test-secret",
			handler: createAgentRuntimeHandler({
				runtime,
				sharedSecret: "test-secret",
				runtimeRelease: "controlled-sdk",
				onRunError: errorLog,
				onStreamError: errorLog,
				modelConfig: {
					baseUrl: "http://config",
					fetchImplementation: async () =>
						Response.json({
							api_key: "unused",
							api_protocol: "openai.responses",
							base_url: "https://unused.example/v1",
							model: "controlled",
							name: "primary_agent",
							provider: "openai",
							schema_version: "model_runtime_config.v1",
							target_sha256: target,
						}),
				},
			}),
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("missing HTTP address");
		}
		try {
			const response = await fetch(
				`http://127.0.0.1:${address.port}/internal/agent-requests${stream ? "/stream" : ""}`,
				{
					method: "POST",
					headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
					signal: AbortSignal.timeout(3000),
					body: JSON.stringify({
						activity_attempt: 1,
						user_id: "test",
						request_id: "req-timeout",
						conversation_id: "test",
						operation: "solve",
						deadline_at: new Date(Date.now() + 5_200).toISOString(),
						operation_input: { goal: "hello", max_steps: 1 },
						visible_function_tool_names: [],
						expected_tool_contract_fingerprint: {
							schema_version: fingerprint.schemaVersion,
							tools_sha256: fingerprint.toolsSha256,
							function_schema_sha256: fingerprint.functionSchemaSha256,
						},
						expected_model_target_sha256: target,
						limits: {
							agent_deadline_ms: 200,
							context_char_limit: 16000,
							current_input_char_limit: 8000,
							max_output_tokens: 20,
							max_function_tool_calls: 0,
							max_turns: 1,
							max_plan_steps: 1,
							max_replans: 0,
						},
					}),
				},
			);
			const text = await response.text();
			expect(response.status).toBe(stream ? 200 : 500);
			expect(text).toContain('"code":"agent_deadline_exceeded"');
			expect(text).toContain('"operation":"workflow.solve"');
			expect(text).not.toContain("event: completed");
			expect(modelStarted).toHaveBeenCalledOnce();
			expect(modelAborted).toHaveBeenCalledOnce();
			expect(errorLog).toHaveBeenCalledOnce();
			// Cleanup is still blocked when the complete HTTP response is received.
			cleanup.resolve();
			await new Promise((resolve) => setImmediate(resolve));
			expect(errorLog).toHaveBeenCalledOnce();
		} finally {
			cleanup.resolve();
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});
