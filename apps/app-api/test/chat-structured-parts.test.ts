// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { createPgChatConversationStore } from "../src/modules/chat/store";
import { normalizeSourceItemsPart } from "../src/modules/runtime-command/service/normalize";

describe("chat structured parts", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("maps persisted assistant source items back into conversation detail", async () => {
		const conversationLimit = vi.fn().mockResolvedValue([
			{
				createdAt: new Date("2026-04-27T09:00:00.000Z"),
				id: "conv_02",
				ownerUserId: "user_01",
				title: "计算机类毕业要求",
				updatedAt: new Date("2026-04-27T09:00:02.000Z"),
			},
		]);
		const conversationWhere = vi.fn(() => ({
			limit: conversationLimit,
		}));
		const messageOrderBy = vi.fn().mockResolvedValue([
			{
				conversationId: "conv_02",
				createdAt: new Date("2026-04-27T09:00:02.000Z"),
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_02",
				retryable: false,
				role: "assistant",
				structuredPartsJson: [
					{
						sourceItems: [
							{
								collectionLabel: "培养方案",
								pageLabel: "原文第 87-102 页",
								primaryAction: {
									href: "/docs/curriculum/curriculum_plan/computer-science?hl=root-001#graduation-requirements",
									label: "查看文档",
								},
								sectionTitle: "二、毕业要求",
								snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
								sourceKind: "curriculum",
								targetKind: "canonical_reader",
								title: "计算机类本科人才培养方案",
								versionLabel: "现行版",
							},
							{
								primaryAction: {
									external: true,
									href: "https://www.example.edu/info/1041/12345.htm",
									label: "打开原通知",
								},
								publisherLabel: "示例大学新闻网",
								sourceKind: "notice",
								targetKind: "public_notice_url",
								title: "关于校园开放日安排的通知",
							},
						],
						type: "source_items",
					},
				],
				text: "计算机类培养方案要求学生完成对应课程模块和毕业要求。",
			},
		]);
		const messageWhere = vi.fn(() => ({
			orderBy: messageOrderBy,
		}));
		const sessionSlotOrderBy = vi.fn().mockResolvedValue([]);
		const sessionSlotWhere = vi.fn(() => ({
			orderBy: sessionSlotOrderBy,
		}));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: conversationWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: messageWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: sessionSlotWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatConversationStore({} as never);
		const conversation = await store.getConversationDetailByOwner("user_01", "conv_02");

		expect(conversation?.messages[0]).toMatchObject({
			id: "msg_assistant",
			structuredParts: [
				{
					sourceItems: [
						{
							primaryAction: {
								href: "/docs/curriculum/curriculum_plan/computer-science?hl=root-001#graduation-requirements",
								label: "查看文档",
							},
							title: "计算机类本科人才培养方案",
						},
						{
							primaryAction: {
								href: "https://www.example.edu/info/1041/12345.htm",
								label: "打开原通知",
							},
							targetKind: "public_notice_url",
						},
					],
					type: "source_items",
				},
			],
		});
	});

	it("preserves disabled canonical source actions with proof metadata", async () => {
		const conversationLimit = vi.fn().mockResolvedValue([
			{
				createdAt: new Date("2026-04-27T09:00:00.000Z"),
				id: "conv_disabled_source",
				ownerUserId: "user_01",
				title: "学生手册依据",
				updatedAt: new Date("2026-04-27T09:00:02.000Z"),
			},
		]);
		const conversationWhere = vi.fn(() => ({
			limit: conversationLimit,
		}));
		const messageOrderBy = vi.fn().mockResolvedValue([
			{
				conversationId: "conv_disabled_source",
				createdAt: new Date("2026-04-27T09:00:02.000Z"),
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_disabled_source",
				retryable: false,
				role: "assistant",
				structuredPartsJson: [
					{
						sourceItems: [
							{
								accessScope: "public",
								collection: "regulations/student_rules",
								contentHash: "sha256:student-handbook:chunk-001",
								documentId: "student-handbook",
								evidenceId: "student-handbook:chunk-001",
								primaryAction: {
									disabledReason: "该来源暂未生成可打开的整理版文档。",
									external: false,
									href: null,
									label: "查看文档",
								},
								sectionTitle: "学生手册",
								snippet: "学生应遵守校园网络使用规定。",
								sourceId: "campus-agent://regulations/student_rules/docs/student-handbook",
								sourceKind: "regulation",
								targetKind: "canonical_reader",
								title: "示例大学学生手册",
								versionId: "span://student-handbook/student-handbook:chunk-001",
							},
						],
						type: "source_items",
					},
				],
				text: "学生手册中包含校园网络相关规定。",
			},
		]);
		const messageWhere = vi.fn(() => ({
			orderBy: messageOrderBy,
		}));
		const sessionSlotOrderBy = vi.fn().mockResolvedValue([]);
		const sessionSlotWhere = vi.fn(() => ({
			orderBy: sessionSlotOrderBy,
		}));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: conversationWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: messageWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: sessionSlotWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatConversationStore({} as never);
		const conversation = await store.getConversationDetailByOwner(
			"user_01",
			"conv_disabled_source",
		);

		expect(conversation?.messages[0]).toMatchObject({
			id: "msg_assistant",
			structuredParts: [
				{
					sourceItems: [
						{
							accessScope: "public",
							collection: "regulations/student_rules",
							contentHash: "sha256:student-handbook:chunk-001",
							documentId: "student-handbook",
							evidenceId: "student-handbook:chunk-001",
							primaryAction: {
								disabledReason: "该来源暂未生成可打开的整理版文档。",
								external: false,
								href: null,
								label: "查看文档",
							},
							sourceId: "campus-agent://regulations/student_rules/docs/student-handbook",
							targetKind: "canonical_reader",
							title: "示例大学学生手册",
							versionId: "span://student-handbook/student-handbook:chunk-001",
						},
					],
					type: "source_items",
				},
			],
		});
	});

	it("ignores legacy nested evidence sources", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				evidence: {
					sources: [
						{
							chunk_id: "handbook:scholarship:chunk-0019",
							doc_id: "handbook:scholarship",
							source_ref: "campus-agent://regulations/student_rules/docs/handbook:scholarship",
							source_title: "示例大学本科学生国家奖学金评审办法",
							structural_ref: "span://handbook:scholarship/handbook:scholarship:chunk-0019",
						},
					],
				},
			},
			selectedTool: "knowledge_query",
			status: "completed",
		});

		expect(parts).toEqual([]);
	});

	it("projects finalized external knowledge sources as browser-safe source items", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				sources: [
					{
						canonical_url: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
						snippet: "校园网用户可通过数字校园相关页面查看上网指南。",
						source_kind: "document",
						source_title: "上网指南",
						target_kind: "public_web_url",
					},
					{
						canonical_url: "https://example.com/muc",
						snippet: "外部污染不应进入结果。",
						source_kind: "document",
						source_title: "外部污染",
						target_kind: "public_web_url",
					},
				],
			},
			selectedTool: "knowledge_query",
			status: "completed",
		});

		expect(parts).toEqual([
			{
				sourceItems: [
					expect.objectContaining({
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
							label: "打开网页",
						},
						sourceKind: "document",
						targetKind: "public_web_url",
						title: "上网指南",
					}),
				],
				type: "source_items",
			},
		]);
	});

	it("requires an explicit allowlist for public notice URL source cards", () => {
		const result = {
			sources: [
				{
					original_url: "https://www.example.edu/info/1041/12345.htm",
					source_kind: "notice",
					source_title: "关于校园开放日安排的通知",
					target_kind: "public_notice_url",
				},
			],
		};

		expect(
			normalizeSourceItemsPart({
				result,
				selectedTool: "knowledge_query",
				status: "completed",
			}),
		).toEqual([]);
		expect(
			normalizeSourceItemsPart({
				allowedPublicNoticeHosts: ["www.example.edu"],
				result,
				selectedTool: "knowledge_query",
				status: "completed",
			}),
		).toMatchObject([
			{
				sourceItems: [
					{
						primaryAction: {
							href: "https://www.example.edu/info/1041/12345.htm",
						},
						targetKind: "public_notice_url",
					},
				],
				type: "source_items",
			},
		]);
	});

	it("does not treat public notice allowlist as public web search allowlist", () => {
		const parts = normalizeSourceItemsPart({
			allowedPublicNoticeHosts: ["www.example.edu"],
			result: {
				sources: [
					{
						source_kind: "public_web",
						target_kind: "public_web_url",
						title: "外部网页",
						url: "https://www.example.edu/info/1041/12345.htm",
					},
				],
			},
			selectedTool: "knowledge_query",
			status: "completed",
		});

		expect(parts).toEqual([]);
	});

	it("drops legacy source_cards instead of normalizing them into typed source items", async () => {
		const conversationLimit = vi.fn().mockResolvedValue([
			{
				createdAt: new Date("2026-04-27T09:00:00.000Z"),
				id: "conv_legacy",
				ownerUserId: "user_01",
				title: "旧来源卡片",
				updatedAt: new Date("2026-04-27T09:00:02.000Z"),
			},
		]);
		const conversationWhere = vi.fn(() => ({
			limit: conversationLimit,
		}));
		const messageOrderBy = vi.fn().mockResolvedValue([
			{
				conversationId: "conv_legacy",
				createdAt: new Date("2026-04-27T09:00:02.000Z"),
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_legacy",
				retryable: false,
				role: "assistant",
				structuredPartsJson: [
					{
						sourceCards: [
							{
								collectionLabel: "学生手册",
								href: "/docs/regulations/student_rules/student-handbook?hl=rule-001#article-1",
								pageLabel: "原文第 12 页",
								sectionTitle: "第一条",
								snippet: "学生应遵守学校管理规定。",
								title: "示例大学学生管理规定",
								versionLabel: "现行版",
							},
						],
						type: "source_cards",
					},
				],
				text: "学生应遵守学校管理规定。",
			},
		]);
		const messageWhere = vi.fn(() => ({
			orderBy: messageOrderBy,
		}));
		const sessionSlotOrderBy = vi.fn().mockResolvedValue([]);
		const sessionSlotWhere = vi.fn(() => ({
			orderBy: sessionSlotOrderBy,
		}));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: conversationWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: messageWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: sessionSlotWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatConversationStore({} as never);
		const conversation = await store.getConversationDetailByOwner("user_01", "conv_legacy");

		expect(conversation?.messages[0]).toMatchObject({
			structuredParts: [],
		});
	});

	it("maps persisted campus-service trace cards and drops unsafe trace labels", async () => {
		const conversationLimit = vi.fn().mockResolvedValue([
			{
				createdAt: new Date("2026-04-27T09:00:00.000Z"),
				id: "conv_03",
				ownerUserId: "user_01",
				title: "班车信息来源",
				updatedAt: new Date("2026-04-27T09:00:02.000Z"),
			},
		]);
		const conversationWhere = vi.fn(() => ({
			limit: conversationLimit,
		}));
		const messageOrderBy = vi.fn().mockResolvedValue([
			{
				conversationId: "conv_03",
				createdAt: new Date("2026-04-27T09:00:02.000Z"),
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_03",
				retryable: false,
				role: "assistant",
				structuredPartsJson: [
					{
						traceCards: [
							{
								refs: ["认证通知 #355122", "release_id=notice_release_003"],
								title: "相关通知",
							},
							{
								refs: ["官网来源：graduate-school/contact"],
								title: "debug_only_trace_card",
							},
							{
								refs: ["官网来源：graduate-school/contact", "s3://bucket/private.txt"],
								title: "信息来源",
							},
						],
						type: "campus_service_trace_cards",
					},
				],
				text: "最新班车安排已更新。",
			},
		]);
		const messageWhere = vi.fn(() => ({
			orderBy: messageOrderBy,
		}));
		const sessionSlotOrderBy = vi.fn().mockResolvedValue([]);
		const sessionSlotWhere = vi.fn(() => ({
			orderBy: sessionSlotOrderBy,
		}));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: conversationWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: messageWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: sessionSlotWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([]),
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatConversationStore({} as never);
		const conversation = await store.getConversationDetailByOwner("user_01", "conv_03");

		expect(conversation?.messages[0]).toMatchObject({
			id: "msg_assistant",
			structuredParts: [
				{
					traceCards: [
						{
							refs: ["认证通知 #355122"],
							title: "相关通知",
						},
						{
							refs: ["官网来源：graduate-school/contact"],
							title: "信息来源",
						},
					],
					type: "campus_service_trace_cards",
				},
			],
		});
	});
});
