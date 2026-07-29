import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityRuntimeFactsSuite(): void {
	it("writes request identity and trusted source facts on accept and finalize", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "图书馆开放到 22:00。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					observability: {
						agentRuntime: "openai_agents_sdk",
						terminalReason: "answer",
					},
					result: {
						sources: [
							{
								canonical_url: "/docs/regulations/student_rules/library-hours",
								source_kind: "regulation",
								source_title: "图书馆开放时间",
								target_kind: "canonical_reader",
								version_id: "student-rules-current",
							},
							{
								canonical_url: "/docs/regulations/student_rules/holiday-hours",
								source_kind: "regulation",
								source_title: "节假日开放时间",
								target_kind: "canonical_reader",
								version_id: "student-rules-current",
							},
						],
					},
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(acceptedWrites[0]).toMatchObject({
			requestObservabilityFact: {
				aclDecision: null,
				conversationId: "conv_01HQ",
				failClosed: null,
				requestId: "req_0001",
				status: "accepted",
				supportingSources: [],
				traceAvailable: true,
				traceId: "trace_0001",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestObservabilityFact: {
				aclDecision: "allowed",
				failClosed: false,
				requestId: "req_0001",
				status: "completed",
				supportingSources: [
					{
						canonicalUrl: "/docs/regulations/student_rules/library-hours",
						sourceTitle: "图书馆开放时间",
					},
					{
						canonicalUrl: "/docs/regulations/student_rules/holiday-hours",
						sourceTitle: "节假日开放时间",
					},
				],
				traceAvailable: true,
				traceId: "trace_0001",
			},
		});
	});
}
