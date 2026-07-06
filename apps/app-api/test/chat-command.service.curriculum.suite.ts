import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
	CURRICULUM_PROGRAM_SLOT_NAME,
	CURRICULUM_SEMESTER_SLOT_NAME,
	createCommandStore,
	createConversation,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCurriculumSuite(): void {
	it("writes curriculum follow-up session slots from resolved curriculum completion and replays them into the next execution request", async () => {
		const conversation = {
			...createConversation(),
			title: "培养方案",
		};
		const commandStore = createCommandStore({ conversation });
		const { store: conversationStore } = createConversationStore({ conversation });
		const executionClient: ToolExecutionClient = {
			execute: vi
				.fn()
				.mockResolvedValueOnce({
					answerText: "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
					error: null,
					followUpQuestion: "",
					result: {
						diagnostics: {
							resolved_program_family_title: "民族班",
							resolved_entity_type: "program",
							rewritten_query: "法学民族实验班培养方案里第四学期有什么课",
							session_program_family: "民族实验班",
							session_program: "法学民族实验班",
							session_semester: "第四学期",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:法学（民族实验班）本科人才培养方案" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0001",
				})
				.mockResolvedValueOnce({
					answerText: "第二学期有中国法制史。",
					error: null,
					followUpQuestion: "",
					result: {
						diagnostics: {
							resolved_program_family_title: "民族班",
							resolved_entity_type: "program",
							rewritten_query: "法学民族实验班培养方案里第二学期有什么课",
							session_program_family: "民族实验班",
							session_program: "法学民族实验班",
							session_semester: "第二学期",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:法学（民族实验班）本科人才培养方案" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0002",
				}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store: commandStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		await service.submit({
			payload: {
				conversationId: conversation.id,
				prompt: "法学民族班培养方案里大二下有什么课",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});

		expect(commandStore.finalWrites[0]).toMatchObject({
			sessionSlots: [
				{
					confirmed: true,
					name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
					value: "民族实验班",
				},
				{
					confirmed: true,
					name: CURRICULUM_PROGRAM_SLOT_NAME,
					value: "法学民族实验班",
				},
				{
					confirmed: true,
					name: CURRICULUM_SEMESTER_SLOT_NAME,
					value: "第四学期",
				},
			],
		});

		await service.submit({
			payload: {
				conversationId: conversation.id,
				prompt: "那大一下呢",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});

		expect(commandStore.finalWrites[1]).toMatchObject({
			sessionSlots: [
				{
					confirmed: true,
					name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
					value: "民族实验班",
				},
				{
					confirmed: true,
					name: CURRICULUM_PROGRAM_SLOT_NAME,
					value: "法学民族实验班",
				},
				{
					confirmed: true,
					name: CURRICULUM_SEMESTER_SLOT_NAME,
					value: "第二学期",
				},
			],
		});

		expect(executionClient.execute).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				context: expect.objectContaining({
					session: {
						confirmedSlots: [
							{
								confirmed: true,
								name: CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
								value: "民族实验班",
							},
							{
								confirmed: true,
								name: CURRICULUM_PROGRAM_SLOT_NAME,
								value: "法学民族实验班",
							},
							{
								confirmed: true,
								name: CURRICULUM_SEMESTER_SLOT_NAME,
								value: "第四学期",
							},
						],
						turnCount: 3,
					},
				}),
			}),
		);
	});

	it("does not write curriculum follow-up session slots for clarification responses", async () => {
		const commandStore = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store: commandStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: null,
					followUpQuestion: "你想看哪个民族班？",
					result: {
						diagnostics: {
							clarification_reason: "curriculum_program_conflict",
							candidate_title_summary: [
								"法学（民族实验班）本科人才培养方案",
								"信息与计算科学（民族实验班）本科人才培养方案",
							],
						},
					},
					selectedTool: "knowledge_query",
					status: "needs_clarification",
					traceId: "trace_0001",
				}),
			}),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "民族班培养方案里大二下有什么课",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});

		expect(commandStore.finalWrites[0]).toMatchObject({
			sessionSlots: [],
		});
	});

	it("does not write curriculum follow-up session slots for completed program-family membership answers", async () => {
		const commandStore = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store: commandStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "民大的民族班有法学、信息与计算科学、计算机科学与技术。",
					error: null,
					followUpQuestion: "",
					result: {
						diagnostics: {
							resolved_program_family_title: "民族班",
							resolved_entity_type: "program_family_membership",
							rewritten_query: "民族班有哪些",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:program-family-membership" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "民族班有哪些",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});

		expect(commandStore.finalWrites[0]).toMatchObject({
			sessionSlots: [],
		});
	});

	it("does not write curriculum follow-up session slots for completed course-family answers", async () => {
		const commandStore = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store: commandStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText:
						"思想政治理论课包括习近平新时代中国特色社会主义思想概论、马克思主义基本原理、中华民族共同体概论等课程。",
					error: null,
					followUpQuestion: "",
					result: {
						diagnostics: {
							resolved_course_family_title: "思修课",
							resolved_entity_type: "course_family_membership",
							rewritten_query: "思修课包括哪些课",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:示例大学通识课程思想政治理论课教学计划" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "思修课包括哪些课",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});

		expect(commandStore.finalWrites[0]).toMatchObject({
			sessionSlots: [],
		});
	});
}
