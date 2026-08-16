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

export function registerChatCommandServiceCoreStructuredPart03Suite(): void {
	it("projects only current Campus Docs sources for completed answers", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "计算机类培养方案要求学生完成对应课程模块和毕业要求。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						sources: [
							{
								document_id: "curriculum_plan/computer-science",
								root_unit_ids: ["curriculum-root-001"],
								section_ref:
									"/docs/curriculum/curriculum_plan/computer-science/v/2026-current#graduation-requirements",
								section_title: "二、毕业要求",
								snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
								title: "计算机类本科人才培养方案",
								version_id: "version-computer-science-2026",
								version_label: "2026 版",
								version_slug: "2026-current",
							},
							{
								document_id: "curriculum_plan/computer-science",
								root_unit_ids: ["curriculum-root-002"],
								section_ref:
									"/docs/curriculum/curriculum_plan/computer-science/v/2026-current#graduation-requirements",
								section_title: "二、毕业要求",
								snippet: "重复命中不应生成第二张来源卡片。",
								title: "计算机类本科人才培养方案",
								version_id: "version-computer-science-2026",
								version_label: "2026 版",
								version_slug: "2026-current",
							},
							{
								section_ref: "https://muc.edu.cn/news/open-day#details",
								title: "公开网页",
							},
						],
					},
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "计算机类培养方案的毕业要求是什么？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		const writtenSourcePart = (
			finalWrites[0] as FinalizeRequestWrite | undefined
		)?.assistantMessage.structuredParts.find((part) => part.type === "source_items");
		expect(writtenSourcePart).toEqual({
			sourceItems: [
				expect.objectContaining({
					collectionLabel: "培养方案",
					primaryAction: {
						disabledReason: null,
						external: false,
						href: "/docs/curriculum/curriculum_plan/computer-science/v/2026-current?hl=curriculum-root-001%2Ccurriculum-root-002#graduation-requirements",
						label: "查看文档",
					},
					sectionTitle: "二、毕业要求",
					title: "计算机类本科人才培养方案",
					versionLabel: "2026 版",
				}),
			],
			type: "source_items",
		});
		const responseSourcePart = response.answer.conversation.messages
			.at(-1)
			?.structuredParts?.find((part) => part.type === "source_items");
		expect(responseSourcePart).toEqual(writtenSourcePart);
		const browserFacingPayload = JSON.stringify(response.answer);
		expect(browserFacingPayload).not.toMatch(
			/document_id|root_unit_ids|section_ref|muc\.edu\.cn\/news/u,
		);
	});

	it("normalizes source cards to reader permalinks without raw locator fragments", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "转专业申请需要按规定提交材料并完成审核。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						sources: [
							{
								document_id: "student_rules/student-status",
								root_unit_ids: ["transfer-major-root"],
								section_ref:
									"/docs/regulations/student_rules/student-status/v/2026-current#transfer-major",
								section_title: "转专业申请",
								snippet: "学生申请转专业应在规定时间内提交材料。",
								title: "学生学籍管理规定",
								version_id: "version-student-status-2026",
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
			payload: { conversationId: "conv_01HQ", prompt: "转专业怎么申请？" },
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				structuredParts: [
					{
						sourceItems: [
							{
								collectionLabel: "学生手册",
								primaryAction: {
									href: "/docs/regulations/student_rules/student-status/v/2026-current?hl=transfer-major-root#transfer-major",
									label: "查看文档",
								},
								sectionTitle: "转专业申请",
								title: "学生学籍管理规定",
								versionLabel: "2026 版",
							},
						],
						type: "source_items",
					},
				],
			},
		});
		const payload = JSON.stringify(finalWrites[0]);
		expect(payload).not.toContain('"document_id"');
		expect(payload).not.toContain('"section_ref"');
	});
}
