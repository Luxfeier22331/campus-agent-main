import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../src/primary-agent.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";

const providerConfig = {
	apiKey: "test-provider-key",
	baseUrl: "https://provider.example/v1",
	model: "gpt-test",
	provider: "openai",
	transport: "responses",
};

const testParameterSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		query_text: { type: "string", minLength: 1 },
	},
	required: ["query_text"],
};

const transportPayloadSchemaRef = schemaRef(
	"campus-services-tool-contracts.v1",
	"TransportScheduleLookupPayload",
);
const transportResultSchemaRef = schemaRef(
	"campus-services-tool-contracts.v1",
	"TransportScheduleLookupResult",
);

const catalog: ToolCatalog = {
	schemaVersion: "tool-registry-v4",
	registryVersion: "test",
	runtimeFingerprint: testToolRuntimeFingerprint(),
	tools: [
		{
			name: "transport_schedule_lookup",
			description: "Lookup campus shuttle schedule snapshots.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: transportPayloadSchemaRef,
			resultSchemaRef: transportResultSchemaRef,
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/campus-services/transport-schedule",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
			parameterSchema: testParameterSchema,
		},
	],
};

function schemaRef(schemaName: string, definitionName: string): string {
	return `https://muc.wiki/campus-agent/schemas/${schemaName}.schema.json#/$defs/${definitionName}`;
}

describe("primary agent runtime", () => {
	it("returns a no-tool final answer without synthetic tool routing", async () => {
		const runner: AgentRunner = async ({ input }) =>
			({
				finalOutput: `我是校园问答助手。收到：${input}`,
				terminalEnvelope: {
					kind: "answer",
					answerText: `我是校园问答助手。收到：${input}`,
				},
				providerResponseId: "resp_1",
				toolCalls: [],
				usage: { inputTokens: 12, outputTokens: 8 },
			}) as never;
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
		});

		const result = await runtime.run({
			requestId: "req-no-tool",
			runId: "run-no-tool",
			conversationId: "conversation-1",
			turnId: "turn-1",
			traceId: "trace-1",
			input: "hi 你是谁",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
		});

		expect(result.status).toBe("completed");
		expect(result.finalOutput).toContain("校园问答助手");
		expect(
			(result as { terminalEnvelope?: { kind?: string; answerText?: string } }).terminalEnvelope,
		).toEqual({
			kind: "answer",
			answerText: "我是校园问答助手。收到：hi 你是谁",
		});
		expect(result.selectedTools).toEqual([]);
		expect(result.stageTiming).toEqual(
			expect.objectContaining({
				"agent.runtime_ms": expect.any(Number),
			}),
		);
	});

	it("fails closed when a no-tool final answer has no typed terminal envelope", async () => {
		const runner: AgentRunner = async () => ({
			finalOutput: "我是校园问答助手。",
			providerResponseId: "resp_missing_envelope",
			toolCalls: [],
			usage: { inputTokens: 12, outputTokens: 8 },
		});
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		const result = await runtime.run({
			requestId: "req-missing-envelope",
			runId: "run-missing-envelope",
			conversationId: "conversation-1",
			turnId: "turn-1",
			traceId: "trace-1",
			input: "hi 你是谁",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
		});

		expect(result.status).toBe("failed");
		expect(result.terminalReason).toBe("agent_runtime_failed");
		expect(result.finalOutput).toBe("");
	});

	it("fails closed when the streaming runtime has no streaming runner", async () => {
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner: async () => ({
				finalOutput: "blocking result must not be used for stream",
				providerResponseId: "resp_blocking",
				terminalEnvelope: {
					answerText: "blocking result must not be used for stream",
					kind: "answer",
				},
				toolCalls: [],
				usage: { inputTokens: 1, outputTokens: 1 },
			}),
		});

		const events = runtime.stream({
			requestId: "req-stream-missing-runner",
			runId: "run-stream-missing-runner",
			conversationId: "conversation-1",
			turnId: "turn-1",
			traceId: "trace-1",
			input: "hi",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
		});

		await expect(events[Symbol.asyncIterator]().next()).rejects.toThrow(
			"streaming agent runner is required",
		);
	});

	it("injects bounded personal memory context into runner instructions", async () => {
		let observedInstructions = "";
		const runner: AgentRunner = async ({ instructions }) => {
			observedInstructions = instructions;
			return {
				finalOutput: "我会先给结论。",
				providerResponseId: "resp_memory",
				toolCalls: [],
				usage: { inputTokens: 16, outputTokens: 8 },
			};
		};
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		await runtime.run({
			requestId: "req-memory",
			runId: "run-memory",
			conversationId: "conversation-1",
			turnId: "turn-memory",
			traceId: "trace-memory",
			input: "之后回答能不能先给结论？",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
			memoryContext: {
				contextBlock: "用户记忆:\n- 用户偏好回答先给结论",
				memoryRef: "projection://runs/run-memory/memory/recall",
				schemaVersion: "memory_recall_result_v1",
				selectedMemoryChars: 18,
				selectedMemoryCount: 1,
			},
		});

		expect(observedInstructions).toContain("<personal_memory>");
		expect(observedInstructions).toContain("用户偏好回答先给结论");
		expect(observedInstructions).toContain("Personal memory is advisory context");
	});

	it("injects allowed knowledge scopes into runner instructions", async () => {
		let observedInstructions = "";
		const runtime = createPrimaryAgentRuntime({
			catalog: {
				...catalog,
				tools: [
					...catalog.tools,
					{
						name: "knowledge_query",
						description: "Query admitted campus knowledge.",
						exposure: "model_visible",
						readOnly: true,
						requiresApproval: false,
						payloadSchemaRef: schemaRef("knowledge-tool-contracts.v1", "KnowledgeQueryPayload"),
						resultSchemaRef: schemaRef(
							"knowledge-tool-contracts.v1",
							"KnowledgeAgentTerminalResult",
						),
						handler: {
							type: "agent_handoff",
							target: "knowledge_agent",
						},
						timeoutMs: 1000,
						resultProjectionPolicy: "bounded_json",
						parameterSchema: testParameterSchema,
					},
					{
						name: "knowledge_search",
						description: "Search admitted campus knowledge.",
						exposure: "internal_only",
						readOnly: true,
						requiresApproval: false,
						payloadSchemaRef: schemaRef("knowledge-tool-contracts.v1", "KnowledgeSearchPayload"),
						resultSchemaRef: schemaRef("knowledge-tool-contracts.v1", "KnowledgeSearchResult"),
						handler: {
							type: "execution_control_internal_query",
							endpoint: "/internal/query/knowledge/search",
						},
						timeoutMs: 12000,
						resultProjectionPolicy: "bounded_json",
						parameterSchema: testParameterSchema,
					},
				],
			},
			runner: async ({ instructions }) => {
				observedInstructions = instructions;
				return {
					finalOutput: "我会查询正式知识库。",
					terminalEnvelope: { kind: "answer", answerText: "我会查询正式知识库。" },
					providerResponseId: "resp_allowed_scopes",
					toolCalls: [],
					usage: { inputTokens: 12, outputTokens: 8 },
				};
			},
		});

		await runtime.run({
			requestId: "req-allowed-scopes",
			runId: "run-allowed-scopes",
			conversationId: "conversation-1",
			turnId: "turn-allowed-scopes",
			traceId: "trace-allowed-scopes",
			input: "转专业条件是什么？",
			providerConfig,
			visibleToolNames: ["knowledge_query"],
			allowedKnowledgeScopes: [
				{
					allowedQueryModes: ["current"],
					description: "学生规则、学籍、奖助处分等正式制度。",
					scope: "student_rules",
				},
			],
		});

		expect(observedInstructions).toContain("<allowed_knowledge_scopes>");
		expect(observedInstructions).toContain("student_rules");
		expect(observedInstructions).toContain("学生规则、学籍、奖助处分等正式制度。");
		expect(observedInstructions).toContain("Use only these scope values");
	});

	it("returns a safe prompt trace hashed from the rendered runner instructions", async () => {
		const customInstructions = "Answer with the repo-scoped campus assistant policy.";
		let observedInstructions = "";
		const runner: AgentRunner = async ({ instructions }) => {
			observedInstructions = instructions;
			return {
				finalOutput: "我会先给结论。",
				terminalEnvelope: { kind: "answer", answerText: "我会先给结论。" },
				providerResponseId: "resp_prompt_trace",
				toolCalls: [],
				usage: { inputTokens: 18, outputTokens: 8 },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			instructions: customInstructions,
			runner,
		});

		const result = await runtime.run({
			requestId: "req-prompt-trace",
			runId: "run-prompt-trace",
			conversationId: "conversation-1",
			turnId: "turn-prompt-trace",
			traceId: "trace-prompt-trace",
			input: "之后回答能不能先给结论？",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
			memoryContext: {
				contextBlock: "用户记忆:\n- 用户偏好回答先给结论",
				memoryRef: "projection://runs/run-prompt-trace/memory/recall",
				schemaVersion: "memory_recall_result_v1",
				selectedMemoryChars: 18,
				selectedMemoryCount: 1,
			},
		});

		expect(result.promptTrace).toMatchObject({
			schemaVersion: "agent_runtime_prompt_trace.v1",
			promptId: "primary_agent",
			promptTemplateSha256: sha256(customInstructions),
			renderedPromptSha256: sha256(observedInstructions),
		});
		expect(result.toolRuntimeFingerprint).toEqual(catalog.runtimeFingerprint);
		expect(observedInstructions).toContain("用户偏好回答先给结论");
		expect(JSON.stringify(result.promptTrace)).not.toContain(observedInstructions);
		expect(JSON.stringify(result)).not.toContain("用户偏好回答先给结论");
	});

	it("injects the final model conversation context without replacing the current user input", async () => {
		let observedInput = "";
		let observedInstructions = "";
		const runner: AgentRunner = async ({ input, instructions }) => {
			observedInput = input;
			observedInstructions = instructions;
			return {
				finalOutput: "大一是否可申请需要看转专业办法的年级条件。",
				terminalEnvelope: {
					kind: "answer",
					answerText: "大一是否可申请需要看转专业办法的年级条件。",
				},
				providerResponseId: "resp_context",
				toolCalls: [],
				usage: { inputTokens: 32, outputTokens: 12 },
			};
		};
		const runtime = createPrimaryAgentRuntime({ catalog, runner });
		const runInput = {
			requestId: "req-context",
			runId: "run-context",
			conversationId: "conversation-1",
			turnId: "turn-context",
			traceId: "trace-context",
			input: "那大一能不能申请？",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
			finalModelContext: {
				schemaVersion: "final_model_context.v1" as const,
				currentUserMessage: "那大一能不能申请？",
				recentTurns: [
					{
						messageId: "msg_user_001",
						role: "user" as const,
						content: "转专业条件是什么？",
					},
					{
						messageId: "msg_assistant_002",
						role: "assistant" as const,
						content: "上一轮回答的是转专业申请条件。",
					},
				],
				previousEvidence: [
					{
						accessScope: "public_student_rule",
						contentHash: "sha256:transfer-major-evidence-example",
						documentId: "transfer-major-policy",
						evidenceId: "ev_transfer_rule_01",
						sectionTitle: "申请条件",
						snippet: "学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。",
						sourceId: "regulations/student_rules/transfer-major/v2026",
						title: "本科生转专业管理办法",
						versionId: "rule-transfer-major-2026",
					},
				],
				previousToolResults: [
					{
						contentHash: "sha256:previous-service-result",
						projectionRef: "projection://runs/run_previous_services/finalization",
						requestId: "req_previous_services",
						resultKind: "final_response",
						runId: "run_previous_services",
						status: "completed",
						summary: "上一轮查询了图书馆开放状态。",
					},
				],
				sessionState: {
					confirmedSlots: [
						{
							confirmed: true,
							name: "curriculum_program",
							value: "计算机科学与技术",
						},
					],
					selectedNoticeRef: null,
					turnCount: 2,
				},
				usageSummary: {
					memoryRecallState: "completed" as const,
					modelVisibleItemCount: 6,
					runtimeOnlyItemCount: 8,
					tokenEstimate: 320,
				},
				memoryContext: {
					contextBlock: "用户记忆:\n- 用户偏好先看结论",
					memoryRef: "projection://runs/run-context/memory/recall",
					schemaVersion: "memory_recall_result_v1",
					selectedMemoryChars: 16,
					selectedMemoryCount: 1,
				},
			},
		};

		await runtime.run(runInput);

		expect(observedInput).toBe("那大一能不能申请？");
		expect(observedInstructions).toContain("<conversation_context>");
		expect(observedInstructions).toContain("- assistant: 上一轮回答的是转专业申请条件。");
		expect(observedInstructions).toContain("curriculum_program: 计算机科学与技术");
		expect(observedInstructions).toContain("ev_transfer_rule_01");
		expect(observedInstructions).toContain("previous_tool_results:");
		expect(observedInstructions).toContain("projection://runs/run_previous_services/finalization");
		expect(observedInstructions).toContain("<personal_memory>");
		expect(observedInstructions).toContain("用户偏好先看结论");
	});

	it("passes visible SDK tools to the runner and records selected tool results", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const toolResult = await tools[0]?.execute({
				query_text: "校车今天几点",
				intent: "next_departure",
			});
			return {
				finalOutput: "校车查询完成。",
				terminalEnvelope: { kind: "answer", answerText: "校车查询完成。" },
				providerResponseId: "resp_2",
				toolCalls: [
					{
						name: "transport_schedule_lookup",
						argumentsSummary: { intent: "next_departure" },
						result: toolResult,
					},
				],
				usage: { inputTokens: 20, outputTokens: 10 },
			} as never;
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ tool, argumentsJson }) => ({
				status: "completed",
				toolName: tool.name,
				payloadKind: tool.name,
				result: {
					outcome: "resolved_current",
					echo: argumentsJson,
				},
				resultRef: "agent-runtime://run-tool/tools/transport_schedule_lookup",
			}),
		});

		const result = await runtime.run({
			requestId: "req-tool",
			runId: "run-tool",
			conversationId: "conversation-1",
			turnId: "turn-2",
			traceId: "trace-2",
			input: "校车今天几点",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
		});

		expect(result.selectedTools).toEqual(["transport_schedule_lookup"]);
		expect(result.status).toBe("completed");
		expect(result.terminalReason).toBe("answer_completed");
		expect(result.toolResults[0]?.resultRef).toBe(
			"agent-runtime://run-tool/tools/transport_schedule_lookup",
		);
		expect(result.toolResults[0]?.argumentsJson).toEqual({
			query_text: "校车今天几点",
			intent: "next_departure",
		});
		expect(result.usage.outputTokens).toBe(10);
	});

	it("fails closed when a model-visible typed tool has no executor", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const toolResult = await tools[0]?.execute({ query_text: "校车今天几点" });
			return {
				finalOutput: "",
				providerResponseId: "resp_missing_tool_executor",
				toolCalls: [
					{
						name: "transport_schedule_lookup",
						argumentsSummary: { query_text: "校车今天几点" },
						result: toolResult,
					},
				],
				usage: { inputTokens: 18, outputTokens: 4 },
			};
		};
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		const result = await runtime.run({
			requestId: "req-missing-tool-executor",
			runId: "run-missing-tool-executor",
			conversationId: "conversation-1",
			turnId: "turn-4",
			traceId: "trace-4",
			input: "校车今天几点",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
		});

		expect(result.status).toBe("failed");
		expect(result.finalOutput).toBe("");
		expect(result.selectedTools).toEqual(["transport_schedule_lookup"]);
		expect(result.terminalReason).toBe("agent_runtime_failed");
		expect(result.toolResults).toEqual([
			{
				status: "failed",
				toolName: "transport_schedule_lookup",
				payloadKind: "transport_schedule_lookup",
				argumentsJson: { query_text: "校车今天几点" },
				result: { error: "tool executor is not configured" },
				resultRef:
					"agent-runtime://run-missing-tool-executor/tools/transport_schedule_lookup/failed",
				failCloseReason: "tool_executor_not_configured",
			},
		]);
	});

	it("fails the primary agent run when a selected tool fails closed", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const toolResult = await tools[0]?.execute({
				query_text: "校车今天几点",
				intent: "next_departure",
			});
			return {
				finalOutput: "校车查询失败。",
				providerResponseId: "resp_failed_tool",
				toolCalls: [
					{
						name: "transport_schedule_lookup",
						argumentsSummary: { intent: "next_departure" },
						result: toolResult,
					},
				],
				usage: { inputTokens: 20, outputTokens: 10 },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ tool }) => ({
				status: "failed",
				toolName: tool.name,
				payloadKind: tool.name,
				result: {
					error: "source truth unavailable",
				},
				resultRef: "agent-runtime://run-tool/tools/transport_schedule_lookup/failed",
				failCloseReason: "source_truth_unavailable",
			}),
		});

		const result = await runtime.run({
			requestId: "req-tool-failed",
			runId: "run-tool-failed",
			conversationId: "conversation-1",
			turnId: "turn-3",
			traceId: "trace-3",
			input: "校车今天几点",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
		});

		expect(result.status).toBe("failed");
		expect(result.terminalReason).toBe("agent_runtime_failed");
		expect(result.finalOutput).toBe("");
		expect(result.toolResults[0]?.failCloseReason).toBe("source_truth_unavailable");
		expect(result.toolResults[0]?.argumentsJson).toEqual({
			query_text: "校车今天几点",
			intent: "next_departure",
		});
	});

	it("propagates the run cancellation signal to the runner and selected tool executor", async () => {
		const controller = new AbortController();
		let runnerSignal: AbortSignal | undefined;
		let executorSignal: AbortSignal | undefined;
		const runner: AgentRunner = async ({ signal, tools }) => {
			runnerSignal = signal;
			const toolResult = await tools[0]?.execute({
				query_text: "校车今天几点",
			});
			return {
				finalOutput: "校车查询完成。",
				terminalEnvelope: { kind: "answer", answerText: "校车查询完成。" },
				providerResponseId: "resp_signal",
				toolCalls: [
					{
						name: "transport_schedule_lookup",
						argumentsSummary: { query_text: "校车今天几点" },
						result: toolResult,
					},
				],
				usage: { inputTokens: 20, outputTokens: 10 },
			} as never;
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ signal, tool, argumentsJson }) => {
				executorSignal = signal;
				return {
					status: "completed",
					toolName: tool.name,
					payloadKind: tool.name,
					argumentsJson,
					result: { outcome: "resolved_current" },
					resultRef: "agent-runtime://run-tool/tools/transport_schedule_lookup",
				};
			},
		});

		const result = await runtime.run({
			requestId: "req-signal",
			runId: "run-signal",
			conversationId: "conversation-1",
			turnId: "turn-signal",
			traceId: "trace-signal",
			input: "校车今天几点",
			providerConfig,
			visibleToolNames: ["transport_schedule_lookup"],
			signal: controller.signal,
		});

		expect(result.status).toBe("completed");
		expect(runnerSignal).toBe(controller.signal);
		expect(executorSignal).toBe(controller.signal);
	});
});

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function testToolRuntimeFingerprint() {
	return {
		combinedSha256: sha256("combined-tool-runtime"),
		functionSchemaSha256: sha256("function-schema"),
		functionSchemaVersion: "tool-function-schemas-v1" as const,
		schemaVersion: "tool_runtime_fingerprint.v1" as const,
		toolsRegistryVersion: "test",
		toolsSchemaVersion: "tool-registry-v4" as const,
		toolsSha256: sha256("tool-registry"),
		workflowArtifactRegistryVersion: "test",
		workflowArtifactSchemaVersion: "workflow-artifact-registry-v2" as const,
		workflowArtifactSha256: sha256("workflow-artifacts"),
	};
}
