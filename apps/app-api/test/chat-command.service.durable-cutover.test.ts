// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionGatewayRuntimeClient } from "../src/modules/integration/execution-gateway";
import { ExecutionGatewayTransportError } from "../src/modules/integration/execution-gateway";
import {
	answerResponsePayload,
	durableEvent,
	durableRun,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
	type SupervisorExecutionClient,
} from "./chat-command.service.test-support";

describe("chat command durable runtime cutover", () => {
	it("rejects blocking deployed chat commands when durable runtime is required but missing", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			generateId: createDeterministicIdGenerator(),
			isDurableRuntimeConfigured: false,
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			requireDurableRuntime: true,
			store,
			supervisor,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "中央民族大学本科学生国家奖学金评审办法",
					requestedCapability: "knowledge",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}),
		).rejects.toMatchObject({
			code: "durable_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(supervisor.execute).not.toHaveBeenCalled();
	});

	it("rejects streaming deployed chat commands when durable runtime is required but missing", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			requireDurableRuntime: true,
			store,
			supervisor,
		});

		await expect(async () => {
			for await (const _event of service.submitStream?.({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "中央民族大学本科学生国家奖学金评审办法",
					requestedCapability: "knowledge",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}) ?? []) {
				throw new Error("stream should fail before emitting events");
			}
		}).rejects.toMatchObject({
			code: "durable_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(supervisor.executeStream).not.toHaveBeenCalled();
	});

	it("rejects blocking deployed chat commands before accept when required durable config is absent", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(),
		};
		const durableRuntime: ExecutionGatewayRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockRejectedValue(
				new ExecutionGatewayTransportError({
					code: "dependency_not_ready",
					message: "Supervisor durable runtime is not configured.",
					retryable: true,
					status: 503,
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableRuntime,
			generateId: createDeterministicIdGenerator(),
			isDurableRuntimeConfigured: false,
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			requireDurableRuntime: true,
			store,
			supervisor,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "中央民族大学本科学生国家奖学金评审办法",
					requestedCapability: "knowledge",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}),
		).rejects.toMatchObject({
			code: "durable_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(durableRuntime.createRun).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(supervisor.execute).not.toHaveBeenCalled();
	});

	it("finalizes blocking accepted chat requests from durable finalization events", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(),
		};
		const durableRuntime: ExecutionGatewayRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue({
				admittedAt: "",
				completedAt: "",
				conversationId: "conv_01HQ",
				createdAt: "2026-06-04T01:02:03Z",
				failCloseReason: "",
				finalResponseRef: "",
				lane: "rag",
				ownerUserId: "user_01HQ",
				requestId: "req_0001",
				requestedCapability: "knowledge",
				runId: "run_0001",
				selectedCapability: "knowledge",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "public_chat_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
				workflowPlanRef: "",
			}),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				{
					conversationId: "conv_01HQ",
					eventId: "event-final",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						request_id: "req_0001",
						trace_id: "trace_0001",
						response: {
							answer_text: "国家奖学金每学年评审一次。",
							confidence: "high",
							error: null,
							follow_up_question: "",
							observability: {
								citation_count: 1,
								citation_expected: true,
								citation_missing: false,
								fail_closed: false,
								retrieval_attempted: true,
								retrieved_source_count: 1,
							},
							result: {
								evidence: {
									sources: [{ doc_id: "student_rules:national-scholarship" }],
								},
							},
							selected_target: "rag-agent",
							status: "completed",
							trace_id: "trace_0001",
						},
					},
					payloadSchemaVersion: "run-event-v1",
					runId: "run_0001",
					sequence: 1,
					visibility: "browser",
				},
			]),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
			supervisor,
			telemetry,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(durableRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (durableRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		const runtimeDecisions = executionPayload.runtime_decisions as Record<string, unknown>;
		const handoff = runtimeDecisions.handoff as Record<string, unknown>;
		const agentRequest = handoff.agent_request as Record<string, unknown>;
		const workflowContext = agentRequest.workflow_context as Record<string, unknown>;
		const agentPayload = agentRequest.payload as Record<string, unknown>;
		const agentPayloadBody = agentPayload.payload as Record<string, unknown>;
		const workflowPlan = runtimeDecisions.workflow_plan as Record<string, unknown>;
		expect(Object.keys(executionPayload).sort()).toEqual([
			"actor",
			"bridge_version",
			"context",
			"conversation_id",
			"effective_capability",
			"lane",
			"request_id",
			"requested_capability",
			"requested_scope",
			"response_contract",
			"runtime_decisions",
			"safety_identifier",
			"trace",
			"user_goal",
			"version_query",
		]);
		expect(executionPayload).toMatchObject({
			bridge_version: "supervisor_bridge_v6",
			response_contract: "agent_response",
			effective_capability: "knowledge",
			lane: "rag",
			requested_capability: "knowledge",
			trace: {
				trace_id: "trace_0001",
			},
			user_goal: "中央民族大学本科学生国家奖学金评审办法",
			version_query: {
				mode: "current",
			},
		});
		expect(runtimeDecisions).toMatchObject({
			effective_capability: "knowledge",
			lane: "rag",
			routing_frame: expect.objectContaining({
				capability: "knowledge",
				needs_clarification: false,
				suggested_next_action: "delegate",
			}),
			runtime_decision_summary: expect.objectContaining({
				planning_outcome: "preplanned",
				selected_target: "rag-agent",
				selected_tool: "retrieval.query",
			}),
			schema_version: "supervisor-runtime-decisions-v1",
		});
		expect(handoff).toMatchObject({
			allowed_tools: [],
			planning_outcome: "preplanned",
			target: "rag-agent",
		});
		expect(agentRequest).toMatchObject({
			allowed_tools: [],
			context: executionPayload.context,
			conversation_id: "conv_01HQ",
			request_id: "req_0001",
			safety_identifier: expect.any(String),
			target: "rag-agent",
			trace: {
				trace_id: "trace_0001",
			},
			user_goal: "中央民族大学本科学生国家奖学金评审办法",
		});
		expect(agentPayload).toMatchObject({
			kind: "rag_request",
		});
		expect(agentPayloadBody).toMatchObject({
			scope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			version_query: {
				mode: "current",
			},
		});
		expect(workflowContext).toMatchObject({
			agent_id: "rag-agent",
			expected_output_artifacts: ["evidence_bundle", "grounding_verdict"],
			projection_refs: [],
			schema_version: "workflow-agent-context-v1",
			step_id: "handoff:rag-agent:rag_request",
			target: "rag-agent",
			visibility: "agent_private",
			workflow_run_ref: "workflow:req_0001",
		});
		expect(workflowPlan).toMatchObject({
			allowed_agents: ["rag-agent"],
			edges: [],
			plan_id: "plan:single_handoff:rag-agent:rag_request",
			schema_version: "workflow-plan-v1",
			steps: [
				{
					allowed_tools: [],
					payload_kind: "rag_request",
					selected_tool: "retrieval.query",
					step_id: "handoff:rag-agent:rag_request",
					step_kind: "handoff",
					target: "rag-agent",
				},
			],
			workflow_mode: "single_handoff",
		});
		expect(durableRuntime.createRun).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			lane: "rag",
			metadata: expect.objectContaining({
				execution_payload: expect.objectContaining({
					actor: expect.objectContaining({
						user_id: "user_01HQ",
					}),
					context: expect.any(Object),
					conversation_id: "conv_01HQ",
					lane: "rag",
					request_id: "req_0001",
					requested_capability: "knowledge",
					requested_scope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					runtime_decisions: expect.any(Object),
					safety_identifier: expect.any(String),
					trace: {
						trace_id: "trace_0001",
					},
					user_goal: "中央民族大学本科学生国家奖学金评审办法",
					version_query: {
						mode: "current",
					},
				}),
				handoff: {
					allowed_tools: [],
					expected_artifacts: ["evidence_bundle", "grounding_verdict"],
					payload: {
						scope: {
							collection: "student_rules",
							corpus: "regulations",
						},
						version_query: {
							mode: "current",
						},
					},
					payload_kind: "rag_request",
					required_projection_kind: "",
					target: "rag-agent",
				},
			}),
			ownerUserId: "user_01HQ",
			requestId: "req_0001",
			requestedCapability: "knowledge",
			runId: "run_0001",
			runtimeVersions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			selectedCapability: "knowledge",
			surface: "public_chat_web",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_0001",
			turnId: "turn_0001",
		});
		expect(metadata).toHaveProperty("handoff");
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "completed",
			},
		});
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(durableRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_0001",
		});
		expect(response).toMatchObject({
			answer: {
				result: {
					kind: "answer",
					text: "国家奖学金每学年评审一次。",
				},
			},
			requestId: "req_0001",
			traceId: "trace_0001",
		});
	});

	it("rejects non-knowledge capabilities before durable RAG run admission", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(),
		};
		const durableRuntime: ExecutionGatewayRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "海淀校区图书馆现在开门吗？",
					requestedCapability: "campus_services",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});

		expect(durableRuntime.createRun).not.toHaveBeenCalled();
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
	});

	it("polls blocking durable run events by cursor until terminal finalization arrives", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(),
		};
		const listRunEvents = vi
			.fn()
			.mockResolvedValueOnce([
				durableEvent({
					eventType: "run.queued",
					payload: { status: "queued" },
					sequence: 1,
				}),
			])
			.mockResolvedValueOnce([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						request_id: "req_0001",
						response: answerResponsePayload(),
						trace_id: "trace_0001",
					},
					sequence: 2,
				}),
			]);
		const durableRuntime: ExecutionGatewayRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(durableRun()),
			getRun: vi.fn(),
			listRunEvents,
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableEventPolling: {
				maxAttempts: 2,
				pollIntervalMs: 0,
				sleep: vi.fn(async () => undefined),
			},
			durableRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
			supervisor,
			telemetry,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(listRunEvents).toHaveBeenNthCalledWith(1, {
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_0001",
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(2, {
			afterSequence: 1,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_0001",
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "completed",
			},
		});
		expect(response.answer.result).toMatchObject({
			kind: "answer",
			text: "国家奖学金每学年评审一次。",
		});
	});
});
