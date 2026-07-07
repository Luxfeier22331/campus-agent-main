import { describe, expect, it } from "vitest";

import { toAssistantThreadMessages } from "../src/features/conversation/assistant-ui-mappers";
import type { ConversationDetail } from "../src/features/conversation/model";

describe("assistant-ui conversation mappers", () => {
	it("keeps assistant text and structured source cards as assistant-ui message parts", () => {
		const conversation: ConversationDetail = {
			archivedAt: null,
			createdAt: "2026-06-21T01:00:00.000Z",
			id: "conv_01HQ",
			messages: [
				{
					conversationId: "conv_01HQ",
					createdAt: "2026-06-21T01:00:00.000Z",
					id: "msg_user",
					kind: null,
					requestId: null,
					retryable: null,
					role: "user",
					text: "国家奖学金什么时候评审？",
				},
				{
					conversationId: "conv_01HQ",
					createdAt: "2026-06-21T01:00:02.000Z",
					id: "msg_assistant",
					kind: "answer",
					requestId: "req_01HQ",
					retryable: false,
					role: "assistant",
					structuredParts: [
						{
							sourceItems: [
								{
									collectionLabel: "学生手册",
									pageLabel: "第 12 页",
									primaryAction: {
										disabledReason: null,
										external: false,
										href: "/docs/regulations/student-rules/national-scholarship",
										label: "查看来源",
									},
									publisherLabel: "中央民族大学",
									sectionTitle: "国家奖学金",
									snippet: "国家奖学金每学年评审一次。",
									title: "本科学生国家奖学金评审办法",
									trustLabel: "正式制度",
									versionLabel: "现行",
								},
							],
							type: "source_items",
						},
					],
					text: "国家奖学金每学年评审一次。",
				},
			],
			pinnedAt: null,
			title: "国家奖学金",
			updatedAt: "2026-06-21T01:00:02.000Z",
		};

		expect(toAssistantThreadMessages(conversation)).toEqual([
			{
				content: [{ text: "国家奖学金什么时候评审？", type: "text" }],
				createdAt: new Date("2026-06-21T01:00:00.000Z"),
				id: "msg_user",
				role: "user",
			},
			{
				content: [
					{ text: "国家奖学金每学年评审一次。", type: "text" },
					{
						data: conversation.messages[1].structuredParts?.[0],
						name: "source_items",
						type: "data",
					},
				],
				createdAt: new Date("2026-06-21T01:00:02.000Z"),
				id: "msg_assistant",
				role: "assistant",
			},
		]);
	});
});
