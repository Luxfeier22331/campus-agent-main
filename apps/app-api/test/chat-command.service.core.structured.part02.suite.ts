import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromCapabilityClient,
	createPrincipal,
	expectNoInternalLocators,
	type FinalizeRequestWrite,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart02Suite(): void {
	it("renders campus-services answers from structured tool facts and safe source categories", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const cases = [
			{
				answerText:
					"地铁接驳车首班车时间为 08:00（海淀东门 -> 五棵松地铁站）。最新提示：今日接驳车候车点调整至海淀东门。来源：校内通知。",
				expected: [
					"地铁接驳车首班车时间为 08:00（海淀东门 -> 五棵松地铁站）",
					"最新提示：今日接驳车候车点调整至海淀东门。",
					"来源：校内通知",
				],
				expectedTraceRef: "认证通知 #354777",
				forbidden: [
					"transport_schedule_release",
					"authenticated_notice:354777",
					"notice:muc_internal_portal:354777",
				],
				prompt: "今天地铁接驳车最早几点",
				result: {
					payload_kind: "transport_schedule_lookup",
					tool_result: {
						operational_notices: [
							{
								operational_comment: "今日接驳车候车点调整至海淀东门。",
								source_ref: "notice:muc_internal_portal:354777",
							},
						],
						related_notice_refs: ["authenticated_notice:354777"],
						resolved_route: {
							display_name: "地铁接驳车",
						},
						selected_departure: {
							departure_at: "2026-04-24T08:00:00+08:00",
							destination_stop_ref: {
								display_name: "五棵松地铁站",
							},
							origin_stop_ref: {
								display_name: "海淀东门",
							},
						},
					},
				},
			},
		] as const;
		const executionClient: CapabilityExecutionClient = {
			execute: vi.fn(async (input) => {
				const currentCase = cases.find((candidate) => candidate.prompt === input.userGoal);
				if (!currentCase) {
					throw new Error(`Unexpected campus-services prompt: ${input.userGoal}`);
				}
				return {
					answerText: currentCase.answerText,
					error: null,
					followUpQuestion: "",
					result: currentCase.result,
					selectedCapability: "campus_services",
					status: "completed",
					traceId: "trace_0003",
				} as const;
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient(executionClient),
		});

		for (const [index, currentCase] of cases.entries()) {
			const response = await service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: currentCase.prompt,
				},
				principal: createPrincipal(),
				surface: "campus_web",
			});
			expect(response.answer.result.kind).toBe("answer");
			if (response.answer.result.kind !== "answer") {
				throw new Error("expected completed answer result");
			}
			const answerText = response.answer.result.text;
			expectNoInternalLocators(answerText);
			for (const expectedFragment of currentCase.expected) {
				expect(answerText).toContain(expectedFragment);
			}
			for (const forbiddenFragment of currentCase.forbidden) {
				expect(answerText).not.toContain(forbiddenFragment);
			}

			const finalizedWrite = finalWrites[index] as FinalizeRequestWrite;
			expect(finalizedWrite.assistantMessage.text).toBe(answerText);
			expect(finalizedWrite.requestExecution.selectedCapability).toBe("campus_services");
			const tracePart = finalizedWrite.assistantMessage.structuredParts.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			expect(tracePart).toBeDefined();
			if (!(tracePart && tracePart.type === "campus_service_trace_cards")) {
				throw new Error("expected campus_service_trace_cards structured part");
			}
			expect(tracePart.traceCards.length).toBeGreaterThan(0);
			const traceRefs = tracePart.traceCards.flatMap((card) => card.refs);
			expect(traceRefs.join(" ")).toContain(currentCase.expectedTraceRef);
			const tracePayload = JSON.stringify(tracePart);
			expect(tracePayload).not.toContain("authenticated_notice:");
			expect(tracePayload).not.toContain("official_web:");
			expect(tracePayload).not.toContain("release_id");
			expect(tracePayload).not.toContain("projection_internal_state");
			expect(tracePayload).not.toContain("table_parser_state");
			expect(response.answer.conversation.messages.at(-1)?.structuredParts).toContainEqual(
				tracePart,
			);
		}
	});
}
