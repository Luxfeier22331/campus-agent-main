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

export function registerChatCommandServiceCoreValidationSuite(): void {
	it("passes explicit versionQuery through validation, tool execution, and request writes", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "2024 版学生手册中图书馆开放到 21:30。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [{ doc_id: "handbook:library-hours:v2024" }],
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
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "2024 版学生手册里的图书馆开放到几点？",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			},
			principal: createPrincipal(),
		});

		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				versionQueryMode: "historical",
				versionQuerySummary: "historical:v2024-student-rules",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				versionQueryMode: "historical",
				versionQuerySummary: "historical:v2024-student-rules",
			},
		});
	});
	it("rejects invalid versionQuery shapes before request acceptance", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn(),
			}),
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "比较 2024 和 2025 版学生手册",
					versionQuery: {
						compareToVersionId: "v2025-student-rules",
						mode: "compare",
					},
				},
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			details: { field: "versionQuery.versionId" },
			status: 422,
		});
	});
}
