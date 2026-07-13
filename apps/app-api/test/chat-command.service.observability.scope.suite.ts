import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityScopeSuite(): void {
	it("keeps public requested scope empty and records the finalized scope", async () => {
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
					followUpQuestion: "",
					observability: {
						agentRuntime: "openai_agents_sdk",
						selectedTools: ["knowledge_query"],
						terminalReason: "answer",
					},
					result: {
						sources: [
							{
								canonical_url: "/docs/curriculum/curriculum_plan/ethnology",
								source_kind: "curriculum",
								source_title: "民族学本科人才培养方案",
								target_kind: "canonical_reader",
								version_id: "curriculum-current",
							},
						],
					},
					resolvedScope: "curriculum",
					selectedTool: "knowledge_query",
					sessionUpdate: null,
					status: "completed",
					traceId: "trace_0001",
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
			turnDispatch: {
				requestedScope: null,
			},
			requestObservabilityFact: {
				requestedScopeSummary: null,
				resolvedScopeSummary: null,
			},
		});
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {
				requestedScope: null,
			},
			requestObservabilityFact: {
				requestedScopeSummary: null,
				resolvedScopeSummary: "curriculum",
				supportingSources: [
					{
						canonicalUrl: "/docs/curriculum/curriculum_plan/ethnology",
						sourceTitle: "民族学本科人才培养方案",
					},
				],
			},
		});
	});
}
