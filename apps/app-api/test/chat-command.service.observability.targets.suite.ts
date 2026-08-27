import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilitySupportingSourcesSuite(): void {
	it("records execution supporting sources", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "民族学本科人才培养方案总学分要求以培养方案正文为准。",
					error: null,
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
								citation_index: 1,
								document_id: "curriculum_plan/ethnology",
								kind: "campus_document",
								root_unit_ids: ["ethnology-credits"],
								section_ref: "/docs/curriculum/curriculum_plan/ethnology/v/2026-current#credits",
								section_title: "学分要求",
								snippet: "总学分要求以培养方案正文为准。",
								title: "民族学本科人才培养方案",
								version_id: "version-ethnology-2026",
								version_label: "2026 版",
								version_slug: "2026-current",
							},
						],
					},
					status: "completed",
				}),
			}),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "民族学本科人才培养方案总学分要求是多少？",
			},
			principal: createPrincipal(),
		});

		expect(acceptedWrites[0]).toMatchObject({
			turnDispatch: {},
			requestObservabilityFact: {},
		});
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {},
			requestObservabilityFact: {},
		});
	});
}
