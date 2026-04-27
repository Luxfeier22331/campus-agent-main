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

	it("maps persisted assistant source cards back into conversation detail", async () => {
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
						sourceCards: [
							{
								collectionLabel: "培养方案",
								href: "/docs/curriculum/curriculum_plan/computer-science?hl=root-001#graduation-requirements",
								pageLabel: "原文第 87-102 页",
								sectionTitle: "二、毕业要求",
								snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
								title: "计算机类本科人才培养方案",
								versionLabel: "现行版",
							},
						],
						type: "source_cards",
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
					sourceCards: [
						{
							href: "/docs/curriculum/curriculum_plan/computer-science?hl=root-001#graduation-requirements",
							title: "计算机类本科人才培养方案",
						},
					],
					type: "source_cards",
				},
			],
		});
	});
});
