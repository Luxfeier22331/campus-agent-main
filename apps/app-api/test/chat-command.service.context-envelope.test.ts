// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "../src/modules/chat";
import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import {
	answerResponsePayload,
	durableEvent,
	durableRun,
	emptyRunStepTrajectory,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
} from "./chat-command.service.test-support";

describe("chat command context envelope assembly", () => {
	it("writes a server-built conversation envelope into durable execution metadata", async () => {
		const conversation: ChatConversation = {
			id: "conv_01HQ",
			ownerUserId: "user_01HQ",
			title: "转专业条件",
			createdAt: "2026-06-21T00:00:00.000Z",
			updatedAt: "2026-06-21T00:00:08.000Z",
			sessionSlots: [
				{
					confirmed: true,
					name: "policy_topic",
					updatedAt: "2026-06-21T00:00:08.000Z",
					value: "转专业",
				},
			],
			messages: [
				{
					id: "msg_user_0001",
					conversationId: "conv_01HQ",
					role: "user" as const,
					kind: null,
					text: "转专业条件是什么？",
					createdAt: "2026-06-21T00:00:00.000Z",
					requestId: null,
					retryable: null,
					structuredParts: [],
				},
				{
					id: "msg_assistant_0002",
					conversationId: "conv_01HQ",
					role: "assistant" as const,
					kind: "answer" as const,
					text: "转专业通常需要满足成绩、名额、学院审核等条件。",
					createdAt: "2026-06-21T00:00:08.000Z",
					requestId: "req_previous",
					retryable: null,
					structuredParts: [
						{
							type: "source_items" as const,
							sourceItems: [
								{
									accessScope: "public_student_rule",
									collectionLabel: "学生管理制度",
									collection: "regulations/student_rules",
									contentHash: "sha256:transfer-major-evidence-example",
									documentId: "transfer-major-policy",
									evidenceId: "ev_transfer_rule_01",
									evidenceRole: "condition",
									primaryAction: {
										disabledReason: null,
										external: false,
										href: "/docs/regulations/student_rules/transfer-major",
										label: "查看文档",
									},
									publisherLabel: "",
									publishedAt: "",
									sectionTitle: "申请条件",
									secondaryActions: [],
									snippet: "学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。",
									snapshotId: "student-rules-current-2026-06-21",
									sourceId: "regulations/student_rules/transfer-major/v2026",
									sourceKind: "regulation",
									targetKind: "canonical_reader",
									title: "本科生转专业管理办法",
									pageLabel: "",
									trustLabel: "",
									versionLabel: "2026",
									versionId: "rule-transfer-major-2026",
								},
							],
						},
					],
				},
			],
		};
		const { acceptedWrites, store } = createCommandStore({ conversation });
		const { store: conversationStore } = createConversationStore({ conversation });
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					taskQueue: "campus-agent.workflow",
					requestedTool: "knowledge_query",
					selectedTool: "knowledge_query",
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					payload: {
						request_id: "req_0001",
						response: answerResponsePayload("大一是否可申请需要看转专业办法的年级条件。"),
						trace_id: "trace_0001",
					},
					sequence: 1,
					visibility: "internal",
				}),
			]),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-21T00:01:00.000Z"),
			conversationStore,
			store,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "那大一能不能申请？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				turnSequence: 3,
				userMessageId: "msg_0001",
			},
			userMessage: {
				branchId: "branch_active",
				parentMessageId: "msg_assistant_0002",
				runId: "run_0001",
				turnSequence: 3,
			},
		});
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		const context = executionPayload.context as Record<string, unknown>;

		expect(context).not.toHaveProperty("profile_memory");
		expect(executionPayload).not.toHaveProperty("conversation_context");
		const conversationContext = context.conversation as Record<string, unknown>;
		expect(conversationContext).toMatchObject({
			schema_version: "conversation_context.v1",
			conversation_id: "conv_01HQ",
			user_message_id: "msg_0001",
			parent_message_id: "msg_assistant_0002",
			current_user_message: {
				role: "user",
				content: "那大一能不能申请？",
				created_at: "2026-06-21T00:01:00.000Z",
			},
			recent_turns: [
				expect.objectContaining({ role: "user", content: "转专业条件是什么？" }),
				expect.objectContaining({
					role: "assistant",
					content: "转专业通常需要满足成绩、名额、学院审核等条件。",
				}),
			],
			previous_evidence_refs: [
				expect.objectContaining({
					access_scope: "public_student_rule",
					collection: "regulations/student_rules",
					content_hash: "sha256:transfer-major-evidence-example",
					evidence_id: "ev_transfer_rule_01",
					source_id: "regulations/student_rules/transfer-major/v2026",
					version_id: "rule-transfer-major-2026",
				}),
			],
		});
		for (const retiredField of [
			"budget",
			"context_summary",
			"memory_recall",
			"previous_answer_summary",
			"source_attribution",
			"truncation",
			"visibility",
		]) {
			expect(conversationContext).not.toHaveProperty(retiredField);
		}
	});

	it("adds sanitized previous tool result refs from runtime projection truth", async () => {
		const conversation: ChatConversation = {
			id: "conv_services",
			ownerUserId: "user_01HQ",
			title: "图书馆服务",
			createdAt: "2026-06-21T00:00:00.000Z",
			updatedAt: "2026-06-21T00:00:08.000Z",
			activeBranchId: "branch_active",
			activeMessageId: "msg_assistant_0002",
			activeRunId: "run_previous",
			activeTurnSequence: 2,
			sessionSlots: [],
			messages: [
				{
					id: "msg_user_0001",
					conversationId: "conv_services",
					role: "user" as const,
					kind: null,
					text: "图书馆今天开吗？",
					createdAt: "2026-06-21T00:00:00.000Z",
					requestId: null,
					retryable: null,
					structuredParts: [],
					branchId: "branch_active",
					runId: "run_previous",
					turnSequence: 1,
				},
				{
					id: "msg_assistant_0002",
					conversationId: "conv_services",
					role: "assistant" as const,
					kind: "answer" as const,
					text: "图书馆今天正常开放。",
					createdAt: "2026-06-21T00:00:08.000Z",
					requestId: "req_previous",
					retryable: null,
					structuredParts: [],
					branchId: "branch_active",
					runId: "run_previous",
					turnSequence: 2,
				},
			],
		};
		const { acceptedWrites, store } = createCommandStore({ conversation });
		store.listPreviousToolResultRefs = vi.fn(async () => [
			{
				tool: "transport_schedule_lookup",
				contentHash: "sha256:previous-service-result",
				projectionRef: "projection://runs/run_previous/finalization",
				requestId: "req_previous",
				resultKind: "final_response",
				runId: "run_previous",
				status: "completed",
				summary: "图书馆今天正常开放。",
			},
		]);
		const { store: conversationStore } = createConversationStore({ conversation });
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					taskQueue: "campus-agent.workflow",
					requestedTool: "transport_schedule_lookup",
					selectedTool: "transport_schedule_lookup",
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					payload: {
						request_id: "req_0001",
						response: answerResponsePayload("闭馆前半小时不能入馆。"),
						trace_id: "trace_0001",
					},
					sequence: 1,
					visibility: "internal",
				}),
			]),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-21T00:01:00.000Z"),
			conversationStore,
			store,
		});

		await service.submit({
			payload: {
				conversationId: "conv_services",
				prompt: "那闭馆前多久不能进？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(store.listPreviousToolResultRefs).toHaveBeenCalledWith({
			conversationId: "conv_services",
			limit: 3,
			ownerUserId: "user_01HQ",
			beforeTurnSequence: 3,
		});
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		const context = executionPayload.context as Record<string, unknown>;
		expect(context.conversation).toMatchObject({
			previous_tool_results: [
				{
					tool: "transport_schedule_lookup",
					content_hash: "sha256:previous-service-result",
					projection_ref: "projection://runs/run_previous/finalization",
					request_id: "req_previous",
					result_kind: "final_response",
					run_id: "run_previous",
					status: "completed",
					summary: "图书馆今天正常开放。",
				},
			],
		});
		expect(context.conversation).not.toHaveProperty("visibility");
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				turnSequence: 3,
			},
		});
	});
});
