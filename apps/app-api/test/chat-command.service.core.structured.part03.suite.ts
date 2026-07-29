import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	type FinalizeRequestWrite,
	PUBLIC_NOTICE_URL_ALLOWLIST,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart03Suite(): void {
	it("projects typed browser-safe source items for completed RAG answers", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			publicNoticeURLAllowlist: PUBLIC_NOTICE_URL_ALLOWLIST,
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
								anchor: {
									page_start: 87,
									page_end: 102,
									reader_anchor: "graduation-requirements",
									root_unit_ids: ["curriculum-root-001", "curriculum-root-002"],
									section_path: ["二、毕业要求"],
								},
								canonical_source_title: "计算机类本科人才培养方案",
								canonical_url: "/docs/curriculum/curriculum_plan/computer-science",
								chunk_id: "curriculum:computer-science:source-faithful:sha256:test:chunk-0001",
								collection: "curriculum_plan",
								doc_id: "curriculum:computer-science",
								is_current: true,
								score: 0.88,
								snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
								source_title: "计算机类本科人才培养方案",
								source_unit_key: "curriculum:computer-science:unit:internal",
								version_id: "version_current",
							},
							{
								anchor: {
									page_start: 87,
									reader_anchor: "graduation-requirements",
									root_unit_ids: ["curriculum-root-001"],
									section_path: ["二、毕业要求"],
								},
								canonical_source_title: "计算机类本科人才培养方案",
								canonical_url: "/docs/curriculum/curriculum_plan/computer-science",
								chunk_id: "chunk-duplicate",
								collection: "curriculum_plan",
								doc_id: "curriculum:computer-science",
								is_current: true,
								snippet: "重复命中不应生成第二张来源卡片。",
								source_title: "计算机类本科人才培养方案",
								version_id: "version_current",
							},
							{
								anchor: {
									reader_anchor: "internal",
									section_path: ["内部材料"],
								},
								canonical_url: "s3://bucket/private-object.json",
								chunk_id: "chunk-private",
								collection: "curriculum_plan",
								doc_id: "curriculum:private",
								is_current: true,
								snippet: "不应展示对象存储来源。",
								source_title: "内部材料",
								version_id: "version_private",
							},
							{
								original_url: "https://www.example.edu/info/1041/12345.htm",
								published_at: "2026-04-20",
								publisher_label: "示例大学新闻网",
								snippet: "学校发布最新公开通知。",
								source_kind: "notice",
								source_title: "关于校园开放日安排的通知",
								target_kind: "public_notice_url",
							},
							{
								anchor: {
									page_start: 12,
									reader_anchor: "notice-summary",
									root_unit_ids: ["notice-root-001"],
									section_path: ["通知要点"],
								},
								canonical_url: "/docs/campus_notices/internal_notice/open-day-notice",
								original_url: "https://portal.example.edu/notices/110",
								published_at: "2026-04-21",
								publisher_label: "示例大学教务处",
								snippet: "整理版通知保留规范化内容。",
								source_kind: "notice",
								source_title: "校园开放日安排整理版",
							},
							{
								internal_notice_id: "355122",
								portal_url:
									"https://portal.example.edu/comsys-portal-notice-web/download?id=private&notice_id=355122",
								published_at: "2026-04-22",
								publisher_label: "校内通知",
								snippet: "该来源需要登录后查看。",
								source_kind: "notice",
								source_title: "校内内部通知",
								target_kind: "restricted_notice",
							},
							{
								original_url:
									"https://portal.example.edu/comsys-portal-notice-web/download?id=private&notice_id=355122",
								snippet: "内部通知不能向公开聊天暴露原始链接。",
								source_kind: "notice",
								source_title: "校内内部通知",
								target_kind: "public_notice_url",
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
		expect(writtenSourcePart).toBeDefined();
		if (!(writtenSourcePart && writtenSourcePart.type === "source_items")) {
			throw new Error("expected source_items structured part");
		}
		expect(writtenSourcePart.sourceItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					collectionLabel: "培养方案",
					pageLabel: "原文第 87-102 页",
					primaryAction: expect.objectContaining({
						href: "/docs/curriculum/curriculum_plan/computer-science?hl=curriculum-root-001,curriculum-root-002#graduation-requirements",
						label: "查看文档",
					}),
					sectionTitle: "二、毕业要求",
					snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
					sourceKind: "curriculum",
					targetKind: "canonical_reader",
					title: "计算机类本科人才培养方案",
					versionLabel: "现行版",
				}),
				expect.objectContaining({
					primaryAction: expect.objectContaining({
						external: true,
						href: "https://www.example.edu/info/1041/12345.htm",
						label: "打开原通知",
					}),
					publishedAt: "2026-04-20",
					publisherLabel: "示例大学新闻网",
					snippet: "学校发布最新公开通知。",
					sourceKind: "notice",
					targetKind: "public_notice_url",
					title: "关于校园开放日安排的通知",
				}),
				expect.objectContaining({
					primaryAction: expect.objectContaining({
						href: "/docs/campus_notices/internal_notice/open-day-notice?hl=notice-root-001#notice-summary",
						label: "查看文档",
					}),
					secondaryActions: [],
					sourceKind: "notice",
					targetKind: "canonical_reader",
					title: "校园开放日安排整理版",
				}),
				expect.objectContaining({
					primaryAction: expect.objectContaining({
						disabledReason: "该来源需要校内身份后才能查看。",
						href: null,
						label: "需登录查看",
					}),
					sourceKind: "notice",
					targetKind: "restricted_notice",
					title: "校内内部通知",
				}),
			]),
		);
		const responseSourcePart = response.answer.conversation.messages
			.at(-1)
			?.structuredParts?.find((part) => part.type === "source_items");
		expect(responseSourcePart).toEqual(writtenSourcePart);
		const browserFacingPayload = JSON.stringify(response.answer);
		expect(browserFacingPayload).not.toContain("chunk_id");
		expect(browserFacingPayload).not.toContain("chunkId");
		expect(browserFacingPayload).not.toContain("source_unit_key");
		expect(browserFacingPayload).not.toContain("sourceUnitKey");
		expect(browserFacingPayload).not.toContain("s3://");
		expect(browserFacingPayload).not.toContain("portal.example.edu");
		expect(browserFacingPayload).not.toContain("notice_id=355122");
		expect(browserFacingPayload).not.toContain("internal_notice_id");
		expect(browserFacingPayload).not.toContain("portal_url");
	});

	it("normalizes source cards to reader permalinks without preserving raw locator fragments", async () => {
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
								anchor: {
									reader_anchor: "transfer-major",
									root_unit_id: "transfer-major-root",
									section_path: ["转专业申请"],
								},
								canonical_source_title: "学生学籍管理规定",
								canonical_url:
									"/docs/regulations/student_rules/student-status?chunk=raw#legacy-fragment",
								collection: "student_rules",
								s3_key: "regulations/private/chunk.json",
								snippet: "学生申请转专业应在规定时间内提交材料。",
								source_title: "学生学籍管理规定",
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
				prompt: "转专业怎么申请？",
			},
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
									href: "/docs/regulations/student_rules/student-status?hl=transfer-major-root#transfer-major",
									label: "查看文档",
								},
								sectionTitle: "转专业申请",
								title: "学生学籍管理规定",
							},
						],
						type: "source_items",
					},
				],
			},
		});
		const payload = JSON.stringify(finalWrites[0]);
		expect(payload).not.toContain("chunk=raw");
		expect(payload).not.toContain("legacy-fragment");
		expect(payload).not.toContain("regulations/private/chunk.json");
	});
}
