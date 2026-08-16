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
								document_id: "student_rules/library-hours",
								root_unit_ids: ["library-hours-default"],
								section_ref:
									"/docs/regulations/student_rules/library-hours/v/2026-current#default-hours",
								section_title: "日常开放时间",
								snippet: "图书馆日常开放到 22:00。",
								title: "图书馆开放时间",
								version_id: "version-library-hours-2026",
								version_label: "2026 版",
								version_slug: "2026-current",
							},
							{
								document_id: "student_rules/holiday-hours",
								root_unit_ids: ["library-hours-holiday"],
								section_ref:
									"/docs/regulations/student_rules/holiday-hours/v/2026-current#holiday-hours",
								section_title: "节假日开放时间",
								snippet: "节假日开放时间另行通知。",
								title: "节假日开放时间",
								version_id: "version-holiday-hours-2026",
								version_label: "2026 版",
								version_slug: "2026-current",
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
				traceAvailable: true,
				traceId: "trace_0001",
			},
		});
	});
}
