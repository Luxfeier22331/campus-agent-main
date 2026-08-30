import { describe, expect, it } from "vitest";

import { toAssistantThreadMessages } from "../src/features/conversation/assistant-ui-mappers";
import type { ChatStructuredPart, ConversationDetail } from "../src/features/conversation/model";

describe("assistant-ui conversation mappers", () => {
	it("keeps assistant text and structured source cards as assistant-ui message parts", () => {
		const structuredPart: ChatStructuredPart = {
			sourceItems: [
				{
					citationIndexes: [1],
					collectionLabel: "学生手册",
					kind: "campus_document",
					primaryAction: {
						disabledReason: null,
						external: false,
						href: "/docs/regulations/student-rules/national-scholarship/v/2026-current",
						label: "查看文档",
					},
					sectionTitle: "国家奖学金",
					snippet: "国家奖学金每学年评审一次。",
					title: "本科学生国家奖学金评审办法",
					versionLabel: "2026 版",
				},
			],
			type: "source_items",
		};
		const conversation: ConversationDetail = {
			archivedAt: null,
			activeRequestId: null,
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
					structuredParts: [structuredPart],
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
						data: structuredPart,
						name: "source_items",
						type: "data",
					},
				],
				createdAt: new Date("2026-06-21T01:00:02.000Z"),
				id: "msg_assistant",
				metadata: {
					custom: {
						campusMessage: {
							kind: "answer",
							requestId: "req_01HQ",
							retryable: false,
						},
					},
				},
				role: "assistant",
			},
		]);
	});

	it("projects message status and existing feedback", () => {
		const conversation: ConversationDetail = {
			archivedAt: null,
			activeRequestId: null,
			createdAt: "2026-06-21T01:00:00.000Z",
			id: "conv_01HQ",
			messages: [
				{
					conversationId: "conv_01HQ",
					createdAt: "2026-06-21T01:00:02.000Z",
					feedback: {
						feedbackId: "feedback_01HQ",
						vote: "unhelpful",
					},
					id: "msg_error",
					kind: "error",
					requestId: "req_01HQ",
					retryable: true,
					role: "assistant",
					text: "请求失败，请重试。",
				},
			],
			pinnedAt: null,
			title: "校园问题",
			updatedAt: "2026-06-21T01:00:02.000Z",
		};

		expect(toAssistantThreadMessages(conversation)[0]).toMatchObject({
			metadata: {
				custom: {
					campusMessage: {
						kind: "error",
						requestId: "req_01HQ",
						retryable: true,
					},
				},
				submittedFeedback: { type: "negative" },
			},
		});
	});
});
