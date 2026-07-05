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

	it("maps persisted assistant place cards back into conversation detail", async () => {
		const conversationLimit = vi.fn().mockResolvedValue([
			{
				createdAt: new Date("2026-04-11T09:00:00.000Z"),
				id: "conv_01",
				ownerUserId: "user_01",
				title: "图书馆在哪里",
				updatedAt: new Date("2026-04-11T09:00:02.000Z"),
			},
		]);
		const conversationWhere = vi.fn(() => ({
			limit: conversationLimit,
		}));
		const messageOrderBy = vi.fn().mockResolvedValue([
			{
				conversationId: "conv_01",
				createdAt: new Date("2026-04-11T09:00:02.000Z"),
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_01",
				retryable: false,
				role: "assistant",
				structuredPartsJson: [
					{
						placeCard: {
							accessNote: "访客请先完成入校登记。",
							campusArea: "主教学区西侧",
							coordinateReferenceSystem: "EPSG:4326",
							displayName: "图书馆",
							entityType: "building",
							locationDescription: "海淀校区主教学区西侧，靠近校医院。",
							placeId: "muc.haidian.library",
						},
						type: "place_card",
					},
				],
				text: "图书馆在海淀校区主教学区西侧，靠近校医院。",
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
		const conversation = await store.getConversationDetailByOwner("user_01", "conv_01");

		expect(conversation?.messages[0]).toMatchObject({
			id: "msg_assistant",
			structuredParts: [
				{
					placeCard: {
						displayName: "图书馆",
						entityType: "building",
						placeId: "muc.haidian.library",
					},
					type: "place_card",
				},
			],
		});
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

	it("derives previous-evidence proof metadata from safe RAG source fields", () => {
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

		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({
			sourceItems: [
				{
					accessScope: "public",
					collection: "regulations/student_rules",
					contentHash: "sha256:handbook:scholarship:chunk-0019",
					documentId: "handbook:scholarship",
					evidenceId: "handbook:scholarship:chunk-0019",
					sourceId: "campus-agent://regulations/student_rules/docs/handbook:scholarship",
					versionId: "span://handbook:scholarship/handbook:scholarship:chunk-0019",
				},
			],
			type: "source_items",
		});
	});

	it("projects public web search results as browser-safe source items", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				model: "gpt-5-search-api-2025-10-14",
				provider: "linux_do",
				query_text: "校园网密码怎么改",
				result_kind: "public_web_evidence",
				sources: [
					{
						content_hash: "sha256:web-source",
						evidence_id: "public_web:abc123",
						publisher_label: "中央民族大学",
						snippet: "校园网用户可通过数字校园相关页面查看上网指南。",
						source_kind: "public_web",
						target_kind: "public_web_url",
						title: "上网指南",
						url: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
					},
					{
						snippet: "外部污染不应进入结果。",
						source_kind: "public_web",
						target_kind: "public_web_url",
						title: "外部污染",
						url: "https://example.com/muc",
					},
				],
			},
			selectedTool: "public_web_search",
			status: "completed",
		});

		expect(parts).toEqual([
			{
				sourceItems: [
					expect.objectContaining({
						collectionLabel: "公开网页",
						contentHash: "sha256:web-source",
						evidenceId: "public_web:abc123",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
							label: "打开网页",
						},
						publisherLabel: "中央民族大学",
						sourceKind: "public_web",
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
			evidence: {
				sources: [
					{
						original_url: "https://www.example.edu/info/1041/12345.htm",
						source_kind: "notice",
						source_title: "关于校园开放日安排的通知",
						target_kind: "public_notice_url",
					},
				],
			},
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
			selectedTool: "public_web_search",
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
