import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart04Suite(): void {
	it("persists navigation place cards even when point geometry is absent", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "民族博物馆在海淀校区西侧，靠近图书馆。",
				error: null,
				followUpQuestion: "",
				result: {
					matched_alias: "民族博物馆",
					place_card: {
						campus_area: "海淀校区西侧",
						location_description: "海淀校区西侧，靠近图书馆。",
						place: {
							campus_area: "海淀校区西侧",
							campus_scope: "haidian",
							display_name: "民族博物馆",
							entity_type: "building",
							place_id: "muc.haidian.museum",
						},
						source_refs: [
							"seed:campus_navigation/place_catalog.v1",
							"campus-map:private-source:official-map",
						],
					},
					query_text: "民族博物馆在哪里",
					resolved_place: {
						campus_area: "海淀校区西侧",
						campus_scope: "haidian",
						display_name: "民族博物馆",
						entity_type: "building",
						place_id: "muc.haidian.museum",
					},
				},
				selectedTool: "place_lookup",
				status: "completed",
				traceId: "trace_0001",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T10:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		await service.submit({
			payload: {
				conversationId: "conv_02HQ",
				prompt: "民族博物馆在哪里",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				structuredParts: [
					{
						placeCard: {
							displayName: "民族博物馆",
							placeId: "muc.haidian.museum",
							pointGeometry: null,
						},
						type: "place_card",
					},
				],
			},
		});
	});
	it("rejects finalized responses when execution omits the accepted traceId", async () => {
		const { store, finalWrites } = createCommandStore();
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
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "",
				}),
			}),
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				surface: "eval_benchmark",
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
			traceId: "trace_0001",
		});
		expect(finalWrites).toHaveLength(0);
	});

	it("keeps the accepted traceId on finalized responses when execution echoes it", async () => {
		const { store, finalWrites } = createCommandStore();
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
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			surface: "eval_benchmark",
		});

		expect(response.traceId).toBe("trace_0001");
		expect(response.answer.result.traceId).toBe("trace_0001");
		expect(response.execution).toMatchObject({
			status: "completed",
			traceId: "trace_0001",
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
			requestObservabilityFact: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
		});
	});
}
