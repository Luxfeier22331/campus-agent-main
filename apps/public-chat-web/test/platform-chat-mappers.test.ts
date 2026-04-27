import { describe, expect, it } from "vitest";

import {
	mapChatAnswerPayload,
	mapConversationDetail,
	mapSessionPrincipal,
} from "../src/platform/chat/mappers";

describe("platform chat mappers", () => {
	it("maps the app-api-backed session principal into shell session shape", () => {
		expect(
			mapSessionPrincipal({
				permissions: {
					chat: true,
					operator: false,
				},
				principal: {
					displayName: "Test Student",
					email: "student@example.edu",
					principalId: "user_123",
					type: "student",
				},
				session: {
					expiresAt: "2026-04-07T00:00:00.000Z",
					sessionId: "sess_123",
				},
			}),
		).toEqual({
			canChat: true,
			displayName: "Test Student",
			email: "student@example.edu",
			principalId: "user_123",
			principalType: "student",
		});
	});

	it("maps conversation detail and preserves user messages as shell user kind", () => {
		expect(
			mapConversationDetail({
				createdAt: "2026-04-06T09:10:00.000Z",
				id: "conv_123",
				messages: [
					{
						conversationId: "conv_123",
						createdAt: "2026-04-06T09:10:00.000Z",
						id: "msg_user",
						kind: null,
						requestId: null,
						retryable: null,
						role: "user",
						text: "法学民族班培养方案里大二下有什么课？",
					},
					{
						conversationId: "conv_123",
						createdAt: "2026-04-06T09:10:02.000Z",
						id: "msg_assistant",
						kind: "clarification",
						requestId: "req_123",
						retryable: false,
						role: "assistant",
						text: "请补充具体专业或培养方案名称。",
					},
				],
				title: "民族班课程",
				updatedAt: "2026-04-06T09:10:02.000Z",
			}),
		).toEqual({
			createdAt: "2026-04-06T09:10:00.000Z",
			id: "conv_123",
			messages: [
				{
					createdAt: "2026-04-06T09:10:00.000Z",
					id: "msg_user",
					kind: "user",
					requestId: null,
					retryable: false,
					role: "user",
					text: "法学民族班培养方案里大二下有什么课？",
				},
				{
					createdAt: "2026-04-06T09:10:02.000Z",
					id: "msg_assistant",
					kind: "clarification",
					requestId: "req_123",
					retryable: false,
					role: "assistant",
					text: "请补充具体专业或培养方案名称。",
				},
			],
			title: "民族班课程",
			updatedAt: "2026-04-06T09:10:02.000Z",
		});
	});

	it("maps assistant place cards into shell structured parts", () => {
		expect(
			mapConversationDetail({
				createdAt: "2026-04-11T09:00:00.000Z",
				id: "conv_123",
				messages: [
					{
						conversationId: "conv_123",
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
					},
				],
				title: "图书馆在哪里",
				updatedAt: "2026-04-11T09:00:02.000Z",
			}),
		).toEqual({
			createdAt: "2026-04-11T09:00:00.000Z",
			id: "conv_123",
			messages: [
				{
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
				},
			],
			title: "图书馆在哪里",
			updatedAt: "2026-04-11T09:00:02.000Z",
		});
	});

	it("maps assistant source items into shell structured parts", () => {
		expect(
			mapConversationDetail({
				createdAt: "2026-04-27T09:00:00.000Z",
				id: "conv_456",
				messages: [
					{
						conversationId: "conv_456",
						createdAt: "2026-04-27T09:00:02.000Z",
						id: "msg_assistant",
						kind: "answer",
						requestId: "req_456",
						retryable: false,
						role: "assistant",
						structuredParts: [
							{
								sourceItems: [
									{
										collectionLabel: "学生手册",
										pageLabel: "原文第 12 页",
										primaryAction: {
											disabledReason: null,
											external: false,
											href: "/docs/regulations/student_rules/student-handbook?hl=rule-001#article-1",
											label: "查看文档",
										},
										publishedAt: "",
										publisherLabel: "",
										sectionTitle: "第一条",
										secondaryActions: [],
										snippet: "学生应遵守学校管理规定。",
										sourceKind: "regulation",
										targetKind: "canonical_reader",
										title: "中央民族大学学生管理规定",
										trustLabel: "",
										versionLabel: "现行版",
									},
								],
								type: "source_items",
							},
						],
						text: "学生应遵守学校管理规定。",
					},
				],
				title: "学生管理规定",
				updatedAt: "2026-04-27T09:00:02.000Z",
			}),
		).toMatchObject({
			messages: [
				{
					structuredParts: [
						{
							sourceItems: [
								{
									primaryAction: {
										href: "/docs/regulations/student_rules/student-handbook?hl=rule-001#article-1",
										label: "查看文档",
									},
									targetKind: "canonical_reader",
									title: "中央民族大学学生管理规定",
								},
							],
							type: "source_items",
						},
					],
				},
			],
		});
	});

	it("maps assistant campus-service trace cards into shell structured parts", () => {
		expect(
			mapConversationDetail({
				createdAt: "2026-04-27T09:00:00.000Z",
				id: "conv_789",
				messages: [
					{
						conversationId: "conv_789",
						createdAt: "2026-04-27T09:00:02.000Z",
						id: "msg_assistant",
						kind: "answer",
						requestId: "req_789",
						retryable: false,
						role: "assistant",
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
						text: "请查看信息溯源。",
					},
				],
				title: "班车信息来源",
				updatedAt: "2026-04-27T09:00:02.000Z",
			}),
		).toMatchObject({
			messages: [
				{
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
				},
			],
		});
	});

	it("maps chat request outcomes into shell request outcome shape", () => {
		expect(
			mapChatAnswerPayload({
				conversation: {
					createdAt: "2026-04-06T09:10:00.000Z",
					id: "conv_123",
					messages: [],
					title: "民族班课程",
					updatedAt: "2026-04-06T09:10:02.000Z",
				},
				result: {
					kind: "answer",
					requestId: "req_456",
					text: "第四学期课程如下。",
					traceId: "trace_456",
				},
			}),
		).toEqual({
			conversation: {
				createdAt: "2026-04-06T09:10:00.000Z",
				id: "conv_123",
				messages: [],
				title: "民族班课程",
				updatedAt: "2026-04-06T09:10:02.000Z",
			},
			requestId: "req_456",
			resultKind: "answer",
			traceId: "trace_456",
		});
	});
});
