import { describe, expect, it } from "vitest";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import type { AgentRunner } from "../src/primary-agent.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";
import { testToolRuntimeFingerprint } from "./helpers/runtime-fingerprint.ts";

const catalog: ToolCatalog = {
	schemaVersion: "tool-registry-v4",
	registryVersion: "test",
	runtimeFingerprint: testToolRuntimeFingerprint(),
	tools: [],
};

describe("agent runtime raw capture HTTP boundary", () => {
	it("accepts raw capture policy off without operator approval fields", async () => {
		let observedDebugTraceConfig: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedDebugTraceConfig = input.debugTraceConfig;
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).run(input);
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
					debug_trace_config: {
						...validDebugTraceConfig(),
						raw_capture_policy: {
							schema_version: "raw_capture_policy.v1",
							mode: "off",
							capture_reason: "disabled",
							ttl_days: 0,
							allowed_sinks: [],
							allowed_raw_fields: [],
							audit_required: false,
							dsar_delete_linkage_required: false,
						},
					},
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(observedDebugTraceConfig).toMatchObject({
			includeModelIo: false,
			rawCapturePolicy: {
				mode: "off",
				operator_principal: null,
				approval_ref: null,
			},
		});
	});

	it("rejects non-off raw capture policy without operator approval fields", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});
		const rawCapturePolicy = {
			...validRawCapturePolicy(),
			operator_principal: null,
			approval_ref: null,
		};

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
					debug_trace_config: {
						...validDebugTraceConfig(),
						raw_capture_policy: rawCapturePolicy,
					},
				}),
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error?: { code?: string; message?: string } };
		expect(body.error?.code).toBe("invalid_request");
		expect(body.error?.message).toContain("raw_capture_policy");
	});
});

const noToolRunner: AgentRunner = async () =>
	({
		finalOutput: "我是校园问答助手。",
		terminalEnvelope: { kind: "answer", answerText: "我是校园问答助手。" },
		providerResponseId: "resp_test",
		toolCalls: [],
		traceRef: "trace_test",
		usage: { inputTokens: 1, outputTokens: 1 },
	}) as never;

function validRunBody(): Record<string, unknown> {
	return {
		request_id: "req-1",
		run_id: "run-1",
		conversation_id: "conversation-1",
		turn_id: "turn-1",
		trace_id: "trace-1",
		input: "hi 你是谁",
		visible_tool_names: [],
	};
}

function validPromptProviderConfig(): Record<string, unknown> {
	return {
		profile_id: "provider-profile-primary",
		revision: 3,
		provider: "openai",
		transport: "responses",
		base_url: "https://api.openai.com/v1",
		model: "gpt-5-mini",
		api_key: "provider-key",
		timeout_ms: 30000,
	};
}

function validDebugTraceConfig(): Record<string, unknown> {
	return {
		schema_version: "llm_debug_trace_config.v1",
		mode: "langfuse_otlp",
		include_model_io: false,
		sample_ratio: 1,
		langfuse_otlp: {
			endpoint: "https://cloud.langfuse.com/api/public/otel",
			auth_header: "Basic langfuse-secret",
			public_trace_base_url: "https://cloud.langfuse.com/project/demo/traces",
		},
	};
}

function validRawCapturePolicy(): Record<string, unknown> {
	return {
		schema_version: "raw_capture_policy.v1",
		mode: "manual_run_capture",
		capture_reason: "diagnose badcase req_debug_001",
		ttl_days: 7,
		allowed_sinks: ["openai_agents_trace", "langfuse_otlp"],
		allowed_raw_fields: ["rendered_messages", "provider_request_body"],
		operator_principal: "operator:test",
		approval_ref: "approval:test:raw-capture",
		request_id: "req-1",
		run_id: "run-1",
		trace_id: "trace-1",
		audit_required: true,
		dsar_delete_linkage_required: true,
	};
}
