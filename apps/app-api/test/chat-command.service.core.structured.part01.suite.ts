import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	type FinalizeRequestWrite,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart01Suite(): void {
	it("preserves execution-control answer text and consumes finalized public sources", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "第四学期有合同法、人格权法、侵权责任法。\n\n课程以培养方案原文为准。",
					error: null,
					followUpQuestion: "",
					result: {
						sources: [
							{
								canonical_url: "/docs/curriculum/law",
								snippet: "第四学期课程包括合同法、人格权法和侵权责任法。",
								source_kind: "curriculum",
								source_title: "法学本科人才培养方案",
								target_kind: "canonical_reader",
							},
						],
					},
					resolvedTargets: ["student_rules"],
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "法学民族班培养方案里大二下有什么课",
			},
			principal: createPrincipal(),
		});
		const finalizedWrite = finalWrites[0] as FinalizeRequestWrite;

		expect(finalizedWrite).toMatchObject({
			assistantMessage: {
				kind: "answer",
			},
			turnDispatch: {
				status: "completed",
			},
		});
		expect(finalizedWrite.assistantMessage.text).toBe(
			"第四学期有合同法、人格权法、侵权责任法。\n\n课程以培养方案原文为准。",
		);
		expect(response.answer.result.kind).toBe("answer");
		if (response.answer.result.kind !== "answer") {
			throw new Error("expected completed answer result");
		}
		expect(response.answer.result.text).toBe(
			"第四学期有合同法、人格权法、侵权责任法。\n\n课程以培养方案原文为准。",
		);
		expect(finalizedWrite.assistantMessage.structuredParts).toMatchObject([
			{
				sourceItems: [
					{
						primaryAction: { href: "/docs/curriculum/law" },
						title: "法学本科人才培养方案",
					},
				],
				type: "source_items",
			},
		]);
	});
}
