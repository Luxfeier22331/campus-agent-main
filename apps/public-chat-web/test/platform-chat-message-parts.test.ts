import { describe, expect, it } from "vitest";

import { mapShellMessageToChatMessage } from "../src/platform/chat/message-parts";

describe("platform chat message parts", () => {
	it("adds a data-place-card part after the assistant text part", () => {
		expect(
			mapShellMessageToChatMessage({
				createdAt: "2026-04-11T09:00:02.000Z",
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_123",
				retryable: false,
				role: "assistant",
				structuredParts: [
					{
						placeCard: {
							campusScope: "海淀校区",
							campusArea: "主教学区西侧",
							coordinateReferenceSystem: "WGS84",
							displayName: "图书馆",
							entityType: "building",
							landmarkHint: "靠近校医院与主干道交叉口",
							locationDescription: "海淀校区主教学区西侧，靠近校医院。",
							pointGeometry: {
								coordinates: [116.31551, 39.96162],
								type: "Point",
							},
							placeId: "muc.haidian.library",
							serviceTags: ["自习", "借阅"],
							sourceRefs: ["campus_navigation/place_catalog/seed.v1.json#library"],
						},
						type: "place_card",
					},
				],
				text: "图书馆在海淀校区主教学区西侧，靠近校医院。",
			}).parts,
		).toEqual([
			{
				text: "图书馆在海淀校区主教学区西侧，靠近校医院。",
				type: "text",
			},
			{
				data: {
					campusScope: "海淀校区",
					campusArea: "主教学区西侧",
					coordinateReferenceSystem: "WGS84",
					displayName: "图书馆",
					entityType: "building",
					landmarkHint: "靠近校医院与主干道交叉口",
					locationDescription: "海淀校区主教学区西侧，靠近校医院。",
					pointGeometry: {
						coordinates: [116.31551, 39.96162],
						type: "Point",
					},
					placeId: "muc.haidian.library",
					serviceTags: ["自习", "借阅"],
					sourceRefs: ["campus_navigation/place_catalog/seed.v1.json#library"],
				},
				type: "data-place-card",
			},
		]);
	});

	it("still emits a place card when assistant text is empty", () => {
		expect(
			mapShellMessageToChatMessage({
				createdAt: "2026-04-11T09:00:02.000Z",
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_456",
				retryable: false,
				role: "assistant",
				structuredParts: [
					{
						placeCard: {
							displayName: "教务处",
							entityType: "office",
							locationDescription: "综合办公楼二层东侧服务大厅。",
							placeId: "muc.haidian.registry-office",
						},
						type: "place_card",
					},
				],
				text: "   ",
			}).parts,
		).toEqual([
			{
				data: {
					displayName: "教务处",
					entityType: "office",
					locationDescription: "综合办公楼二层东侧服务大厅。",
					placeId: "muc.haidian.registry-office",
				},
				type: "data-place-card",
			},
		]);
	});

	it("adds data-source-items after the assistant text part", () => {
		expect(
			mapShellMessageToChatMessage({
				createdAt: "2026-04-27T09:00:02.000Z",
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_789",
				retryable: false,
				role: "assistant",
				structuredParts: [
					{
						sourceItems: [
							{
								collectionLabel: "培养方案",
								pageLabel: "原文第 87-102 页",
								primaryAction: {
									disabledReason: null,
									external: false,
									href: "/docs/curriculum/curriculum_plan/computer-science?hl=root-001#graduation-requirements",
									label: "查看文档",
								},
								publishedAt: "",
								publisherLabel: "",
								sectionTitle: "二、毕业要求",
								secondaryActions: [],
								snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
								sourceKind: "curriculum",
								targetKind: "canonical_reader",
								title: "计算机类本科人才培养方案",
								trustLabel: "",
								versionLabel: "现行版",
							},
							{
								collectionLabel: "",
								pageLabel: "",
								primaryAction: {
									disabledReason: null,
									external: true,
									href: "https://www.muc.edu.cn/info/1041/12345.htm",
									label: "打开原通知",
								},
								publishedAt: "",
								publisherLabel: "中央民族大学新闻网",
								sectionTitle: "",
								secondaryActions: [],
								snippet: null,
								sourceKind: "notice",
								targetKind: "public_notice_url",
								title: "关于校园开放日安排的通知",
								trustLabel: "",
								versionLabel: "",
							},
						],
						type: "source_items",
					},
				],
				text: "计算机类培养方案要求学生完成对应课程模块和毕业要求。",
			}).parts,
		).toEqual([
			{
				text: "计算机类培养方案要求学生完成对应课程模块和毕业要求。",
				type: "text",
			},
			{
				data: [
					{
						collectionLabel: "培养方案",
						pageLabel: "原文第 87-102 页",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/curriculum/curriculum_plan/computer-science?hl=root-001#graduation-requirements",
							label: "查看文档",
						},
						publishedAt: "",
						publisherLabel: "",
						sectionTitle: "二、毕业要求",
						secondaryActions: [],
						snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
						sourceKind: "curriculum",
						targetKind: "canonical_reader",
						title: "计算机类本科人才培养方案",
						trustLabel: "",
						versionLabel: "现行版",
					},
					{
						collectionLabel: "",
						pageLabel: "",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://www.muc.edu.cn/info/1041/12345.htm",
							label: "打开原通知",
						},
						publishedAt: "",
						publisherLabel: "中央民族大学新闻网",
						sectionTitle: "",
						secondaryActions: [],
						snippet: null,
						sourceKind: "notice",
						targetKind: "public_notice_url",
						title: "关于校园开放日安排的通知",
						trustLabel: "",
						versionLabel: "",
					},
				],
				type: "data-source-items",
			},
		]);
	});

	it("drops legacy source_cards parts", () => {
		expect(
			mapShellMessageToChatMessage({
				createdAt: "2026-04-27T09:00:02.000Z",
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_legacy",
				retryable: false,
				role: "assistant",
				structuredParts: [
					{
						sourceCards: [
							{
								collectionLabel: "学生手册",
								href: "/docs/regulations/student_rules/student-handbook",
								pageLabel: "原文第 12 页",
								sectionTitle: "第一条",
								snippet: "学生应遵守学校管理规定。",
								title: "中央民族大学学生管理规定",
								versionLabel: "现行版",
							},
						],
						type: "source_cards",
					},
				],
				text: "学生应遵守学校管理规定。",
			} as unknown as Parameters<typeof mapShellMessageToChatMessage>[0]).parts,
		).toEqual([
			{
				text: "学生应遵守学校管理规定。",
				type: "text",
			},
		]);
	});

	it("adds data-campus-service-trace-cards after assistant text", () => {
		expect(
			mapShellMessageToChatMessage({
				createdAt: "2026-04-27T09:00:02.000Z",
				id: "msg_assistant",
				kind: "answer",
				requestId: "req_790",
				retryable: false,
				role: "assistant",
				structuredParts: [
					{
						traceCards: [
							{
								refs: ["认证通知 #355122", "认证通知 #354777"],
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
				text: "丰台至海淀班车已调整，请查看信息溯源。",
			}).parts,
		).toEqual([
			{
				text: "丰台至海淀班车已调整，请查看信息溯源。",
				type: "text",
			},
			{
				data: [
					{
						refs: ["认证通知 #355122", "认证通知 #354777"],
						title: "相关通知",
					},
					{
						refs: ["官网来源：graduate-school/contact"],
						title: "信息来源",
					},
				],
				type: "data-campus-service-trace-cards",
			},
		]);
	});
});
