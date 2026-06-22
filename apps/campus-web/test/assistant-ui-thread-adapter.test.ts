import { describe, expect, it, vi } from "vitest";

import {
	createCampusAssistantThreadHistoryAdapter,
	createCampusAssistantThreadListAdapter,
	toAssistantThreadMetadata,
} from "../src/features/conversation/assistant-ui-thread-adapter";
import type { ConversationDetail, ConversationSummary } from "../src/features/conversation/model";

const conversationApiMock = vi.hoisted(() => ({
	archiveConversation: vi.fn(),
	createConversationDraft: vi.fn(),
	deleteConversation: vi.fn(),
	getConversationDetail: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
	unarchiveConversation: vi.fn(),
}));

vi.mock("../src/features/conversation/api", () => conversationApiMock);

function summary(input: Partial<ConversationSummary> = {}): ConversationSummary {
	return {
		archivedAt: null,
		createdAt: "2026-06-21T01:00:00.000Z",
		id: "conv_01",
		pinnedAt: null,
		title: "国家奖学金",
		updatedAt: "2026-06-21T01:02:00.000Z",
		...input,
	};
}

function detail(input: Partial<ConversationDetail> = {}): ConversationDetail {
	return {
		...summary(input),
		messages: [],
		...input,
	};
}

describe("assistant-ui thread adapter", () => {
	it("maps campus conversation summaries to assistant-ui thread metadata", () => {
		expect(
			toAssistantThreadMetadata(
				summary({
					archivedAt: "2026-06-21T02:00:00.000Z",
					id: "conv_archived",
					title: "已归档",
				}),
			),
		).toEqual({
			externalId: "conv_archived",
			lastMessageAt: new Date("2026-06-21T01:02:00.000Z"),
			remoteId: "conv_archived",
			status: "archived",
			title: "已归档",
		});
	});

	it("lists active and archived conversations through the remote thread adapter", async () => {
		conversationApiMock.listConversations
			.mockResolvedValueOnce([summary({ id: "conv_active", title: "进行中" })])
			.mockResolvedValueOnce([
				summary({
					archivedAt: "2026-06-21T02:00:00.000Z",
					id: "conv_archived",
					title: "已归档",
				}),
			]);

		const adapter = createCampusAssistantThreadListAdapter();
		const response = await adapter.list();

		expect(conversationApiMock.listConversations).toHaveBeenNthCalledWith(1, {
			limit: 50,
			view: "active",
		});
		expect(conversationApiMock.listConversations).toHaveBeenNthCalledWith(2, {
			limit: 50,
			view: "archived",
		});
		expect(response.nextCursor).toBeUndefined();
		expect(response.threads.map((thread) => [thread.remoteId, thread.status])).toEqual([
			["conv_active", "regular"],
			["conv_archived", "archived"],
		]);
	});

	it("creates a real app-api draft when assistant-ui initializes a new thread", async () => {
		conversationApiMock.createConversationDraft.mockResolvedValue(
			detail({ id: "conv_created", title: "New conversation" }),
		);

		const adapter = createCampusAssistantThreadListAdapter();

		await expect(adapter.initialize("local-thread")).resolves.toEqual({
			externalId: "conv_created",
			remoteId: "conv_created",
		});
		expect(conversationApiMock.createConversationDraft).toHaveBeenCalledOnce();
	});

	it("routes assistant-ui thread mutations to app-api conversation actions", async () => {
		const adapter = createCampusAssistantThreadListAdapter();

		await adapter.archive("conv_01");
		await adapter.unarchive("conv_01");
		await adapter.delete("conv_01");
		await adapter.rename("conv_01", "奖学金申请");

		expect(conversationApiMock.archiveConversation).toHaveBeenCalledWith("conv_01");
		expect(conversationApiMock.unarchiveConversation).toHaveBeenCalledWith("conv_01");
		expect(conversationApiMock.deleteConversation).toHaveBeenCalledWith("conv_01");
		expect(conversationApiMock.renameConversation).toHaveBeenCalledWith({
			conversationId: "conv_01",
			title: "奖学金申请",
		});
	});

	it("loads assistant-ui message history from app-api conversation detail", async () => {
		conversationApiMock.getConversationDetail.mockResolvedValue(
			detail({
				id: "conv_01",
				messages: [
					{
						conversationId: "conv_01",
						createdAt: "2026-06-21T01:00:00.000Z",
						id: "msg_user",
						kind: null,
						requestId: null,
						retryable: null,
						role: "user",
						structuredParts: [],
						text: "hi",
					},
				],
			}),
		);

		const history = createCampusAssistantThreadHistoryAdapter("conv_01");
		const repository = await history.load();

		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith("conv_01");
		expect(repository.messages).toHaveLength(1);
		expect(repository.messages[0]?.message.id).toBe("msg_user");
	});
});
