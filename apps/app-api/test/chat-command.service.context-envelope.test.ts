// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "../src/modules/chat";
import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import {
	answerResponsePayload,
	durableEvent,
	durableEventPage,
	durableRun,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	getFrozenExecutionPayload,
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
									citationIndexes: [1],
									collectionLabel: "学生管理制度",
									kind: "campus_document",
									primaryAction: {
										disabledReason: null,
										external: false,
										href: "/docs/regulations/student_rules/transfer-major/v/2026-current",
										label: "查看文档",
									},
									sectionTitle: "申请条件",
									snippet: "学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。",
									title: "本科生转专业管理办法",
									versionLabel: "2026 版",
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
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue(
				durableEventPage([
					durableEvent({
						eventId: "event-final",
						eventType: "finalization.completed",
						payload: {
							request_id: "req_0001",
							response: answerResponsePayload("大一是否可申请需要看转专业办法的年级条件。"),
						},
						sequence: 1,
						visibility: "internal",
					}),
				]),
			),
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
			turnDispatch: {
				turnSequence: 3,
				userMessageId: "msg_0001",
			},
			userMessage: {
				branchId: "branch_active",
				parentMessageId: "msg_assistant_0002",
				requestId: "req_0001",
				turnSequence: 3,
			},
		});
		const executionPayload = getFrozenExecutionPayload(createRunInput?.requestId ?? "req_0001");
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
		});
		expect(conversationContext).not.toHaveProperty("previous_evidence_refs");
		expect(conversationContext).not.toHaveProperty("previous_tool_results");
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

	it("does not carry previous tool result refs into the execution contract", async () => {
		const conversation: ChatConversation = {
			id: "conv_services",
			ownerUserId: "user_01HQ",
			title: "图书馆服务",
			createdAt: "2026-06-21T00:00:00.000Z",
			updatedAt: "2026-06-21T00:00:08.000Z",
			activeBranchId: "branch_active",
			activeMessageId: "msg_assistant_0002",
			activeRequestId: "req_previous",
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
					turnSequence: 2,
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
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue(
				durableEventPage([
					durableEvent({
						eventId: "event-final",
						eventType: "finalization.completed",
						payload: {
							request_id: "req_0001",
							response: answerResponsePayload("闭馆前半小时不能入馆。"),
						},
						sequence: 1,
						visibility: "internal",
					}),
				]),
			),
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

		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		const executionPayload = getFrozenExecutionPayload(createRunInput?.requestId ?? "req_0001");
		const context = executionPayload.context as Record<string, unknown>;
		expect(context.conversation).not.toHaveProperty("previous_tool_results");
		expect(context.conversation).not.toHaveProperty("previous_evidence_refs");
		expect(context.conversation).not.toHaveProperty("visibility");
		expect(acceptedWrites[0]).toMatchObject({
			turnDispatch: {
				turnSequence: 3,
			},
		});
	});
});
