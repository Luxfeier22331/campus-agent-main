// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import {
	buildChatConversationService,
	type ChatConversationService,
	type ChatConversationStore,
	DRAFT_CONVERSATION_TITLE,
} from "../src/modules/chat";

function createPrincipal(input: Partial<ResolvedAppPrincipal> = {}): ResolvedAppPrincipal {
	const principalType = input.principal?.type ?? input.actor?.principalType ?? "campus_member";
	const defaultRoles =
		principalType === "student" || principalType === "staff" || principalType === "faculty"
			? ["campus_member", principalType]
			: [principalType];
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType,
			roles: defaultRoles,
			userId: "user_01HQ",
			...input.actor,
		},
		permissions: {
			chat: true,
			...input.permissions,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: principalType,
			...input.principal,
		},
		authorization: input.authorization,
		session:
			input.session === undefined
				? {
						expiresAt: "2026-03-29T07:00:00.000Z",
						sessionId: "sess_01HQ",
					}
				: input.session,
	};
}

function createStore(): ChatConversationStore {
	return {
		createConversationDraft: vi.fn(),
		deleteConversationByOwner: vi.fn(),
		deleteConversationsByOwner: vi.fn(),
		deleteMessageFeedbackByOwner: vi.fn(async () => false),
		deleteTrailingMessagesFromMessageByOwner: vi.fn(),
		getConversationByOwner: vi.fn(),
		getConversationDetailByOwner: vi.fn(),
		listConversationSummariesPageByOwner: vi.fn(),
		listConversationSummariesByOwner: vi.fn(),
		markConversationArchivedByOwner: vi.fn(),
		markConversationDeletedByOwner: vi.fn(),
		markConversationPinnedByOwner: vi.fn(),
		renameConversationByOwner: vi.fn(),
		searchConversationSummariesByOwner: vi.fn(),
		upsertMessageFeedbackByOwner: vi.fn(async () => null),
	};
}

describe("chat conversation service", () => {
	it("lists chat conversation summaries for chat-enabled campus principals only", async () => {
		const store = createStore();
		store.listConversationSummariesByOwner = vi.fn().mockResolvedValue([
			{
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
				archivedAt: null,
				pinnedAt: null,
				title: "图书馆开放时间",
				updatedAt: "2026-03-28T08:01:00.000Z",
			},
		]);
		const service = buildChatConversationService({ store });

		await expect(
			service.list({
				principal: createPrincipal({
					permissions: {
						chat: false,
					},
					principal: {
						displayName: "Internal Service",
						email: null,
						principalId: "service:test",
						type: "service",
					},
					session: null,
				}),
			}),
		).rejects.toMatchObject({
			code: "forbidden",
			status: 403,
		});

		await expect(service.list({ principal: createPrincipal() })).resolves.toEqual({
			conversations: [
				{
					archivedAt: null,
					createdAt: "2026-03-28T08:00:00.000Z",
					id: "conv_01HQ",
					pinnedAt: null,
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:01:00.000Z",
				},
			],
		});
		expect(store.listConversationSummariesByOwner).toHaveBeenCalledWith({
			limit: 50,
			ownerUserId: "user_01HQ",
			view: "active",
		});
	});

	it("searches conversation summaries with bounded query and view inputs", async () => {
		const store = createStore();
		vi.mocked(store.searchConversationSummariesByOwner).mockResolvedValue([
			{
				archivedAt: null,
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
				pinnedAt: "2026-03-28T08:02:00.000Z",
				title: "图书馆开放时间",
				updatedAt: "2026-03-28T08:01:00.000Z",
			},
		]);
		const service = buildChatConversationService({ store });

		await expect(
			service.search({
				limit: 10,
				principal: createPrincipal(),
				query: " 图书馆 ",
				view: "active",
			}),
		).resolves.toEqual({
			query: "图书馆",
			conversations: [
				{
					archivedAt: null,
					createdAt: "2026-03-28T08:00:00.000Z",
					id: "conv_01HQ",
					pinnedAt: "2026-03-28T08:02:00.000Z",
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:01:00.000Z",
				},
			],
		});
		expect(store.searchConversationSummariesByOwner).toHaveBeenCalledWith({
			limit: 10,
			ownerUserId: "user_01HQ",
			query: "图书馆",
			view: "active",
		});
	});

	it("renames conversations with explicit non-empty product titles", async () => {
		const store = createStore();
		vi.mocked(store.renameConversationByOwner).mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-03-28T08:00:00.000Z",
			id: "conv_01HQ",
			pinnedAt: null,
			title: "新的会话标题",
			updatedAt: "2026-03-28T08:05:00.000Z",
		});
		const service = buildChatConversationService({
			now: () => new Date("2026-03-28T08:05:00.000Z"),
			store,
		});

		await expect(
			service.rename({
				conversationId: "conv_01HQ",
				principal: createPrincipal(),
				title: " 新的会话标题 ",
			}),
		).resolves.toEqual({
			conversation: {
				archivedAt: null,
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
				pinnedAt: null,
				title: "新的会话标题",
				updatedAt: "2026-03-28T08:05:00.000Z",
			},
		});
		expect(store.renameConversationByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			ownerUserId: "user_01HQ",
			title: "新的会话标题",
			updatedAt: "2026-03-28T08:05:00.000Z",
		});

		await expect(
			service.rename({
				conversationId: "conv_01HQ",
				principal: createPrincipal(),
				title: " ",
			}),
		).rejects.toMatchObject({
			code: "invalid_conversation_title",
			status: 400,
		});
	});

	it("archives, unarchives, pins, unpins, and soft deletes owned conversations", async () => {
		const store = createStore();
		const conversation = {
			archivedAt: null,
			createdAt: "2026-03-28T08:00:00.000Z",
			id: "conv_01HQ",
			pinnedAt: "2026-03-28T08:05:00.000Z",
			title: "图书馆开放时间",
			updatedAt: "2026-03-28T08:05:00.000Z",
		};
		vi.mocked(store.markConversationArchivedByOwner).mockResolvedValue(conversation);
		vi.mocked(store.markConversationPinnedByOwner).mockResolvedValue(conversation);
		vi.mocked(store.markConversationDeletedByOwner).mockResolvedValue(true);
		const service = buildChatConversationService({
			now: () => new Date("2026-03-28T08:05:00.000Z"),
			store,
		});

		await expect(
			service.archive({ conversationId: "conv_01HQ", principal: createPrincipal() }),
		).resolves.toEqual({ conversation });
		await expect(
			service.unarchive({ conversationId: "conv_01HQ", principal: createPrincipal() }),
		).resolves.toEqual({ conversation });
		await expect(
			service.pin({ conversationId: "conv_01HQ", principal: createPrincipal() }),
		).resolves.toEqual({ conversation });
		await expect(
			service.unpin({ conversationId: "conv_01HQ", principal: createPrincipal() }),
		).resolves.toEqual({ conversation });
		await expect(
			service.deleteById({ conversationId: "conv_01HQ", principal: createPrincipal() }),
		).resolves.toEqual({ deleted: true });

		expect(store.markConversationArchivedByOwner).toHaveBeenCalledWith({
			archivedAt: "2026-03-28T08:05:00.000Z",
			conversationId: "conv_01HQ",
			ownerUserId: "user_01HQ",
			updatedAt: "2026-03-28T08:05:00.000Z",
		});
		expect(store.markConversationArchivedByOwner).toHaveBeenCalledWith({
			archivedAt: null,
			conversationId: "conv_01HQ",
			ownerUserId: "user_01HQ",
			updatedAt: "2026-03-28T08:05:00.000Z",
		});
		expect(store.markConversationPinnedByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			ownerUserId: "user_01HQ",
			pinnedAt: "2026-03-28T08:05:00.000Z",
			updatedAt: "2026-03-28T08:05:00.000Z",
		});
		expect(store.markConversationPinnedByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			ownerUserId: "user_01HQ",
			pinnedAt: null,
			updatedAt: "2026-03-28T08:05:00.000Z",
		});
		expect(store.markConversationDeletedByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			deletedAt: "2026-03-28T08:05:00.000Z",
			ownerUserId: "user_01HQ",
			updatedAt: "2026-03-28T08:05:00.000Z",
		});
	});

	it("creates draft conversations with the canonical default title", async () => {
		const store = createStore();
		store.createConversationDraft = vi.fn().mockResolvedValue({
			createdAt: "2026-03-28T08:00:00.000Z",
			id: "conv_0001",
			messages: [],
			ownerUserId: "user_01HQ",
			title: DRAFT_CONVERSATION_TITLE,
			updatedAt: "2026-03-28T08:00:00.000Z",
		});
		const service = buildChatConversationService({
			generateId: () => "conv_0001",
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			store,
		});

		await expect(service.createDraft({ principal: createPrincipal() })).resolves.toEqual({
			conversation: {
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_0001",
				messages: [],
				title: DRAFT_CONVERSATION_TITLE,
				updatedAt: "2026-03-28T08:00:00.000Z",
			},
		});
		expect(store.createConversationDraft).toHaveBeenCalledWith({
			conversationId: "conv_0001",
			createdAt: "2026-03-28T08:00:00.000Z",
			ownerUserId: "user_01HQ",
			title: DRAFT_CONVERSATION_TITLE,
			updatedAt: "2026-03-28T08:00:00.000Z",
		});
	});

	it("returns owned conversation detail and hides missing conversations behind 404", async () => {
		const store = createStore();
		const detailStore = {
			getConversationDetailByOwner: vi
				.fn()
				.mockResolvedValueOnce({
					createdAt: "2026-03-28T08:00:00.000Z",
					id: "conv_01HQ",
					messages: [],
					ownerUserId: "user_01HQ",
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:01:00.000Z",
				})
				.mockResolvedValueOnce(null),
		};
		const service = buildChatConversationService({ detailStore, store });

		await expect(
			service.getById({
				conversationId: "conv_01HQ",
				principal: createPrincipal(),
			}),
		).resolves.toEqual({
			conversation: {
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
				messages: [],
				title: "图书馆开放时间",
				updatedAt: "2026-03-28T08:01:00.000Z",
			},
		});
		expect(store.getConversationDetailByOwner).not.toHaveBeenCalled();
		expect(detailStore.getConversationDetailByOwner).toHaveBeenCalledWith("user_01HQ", "conv_01HQ");

		await expect(
			service.getById({
				conversationId: "conv_missing",
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "conversation_not_found",
			status: 404,
		});
	});

	it("deletes trailing messages from the selected owned message and hides missing message targets behind 404", async () => {
		const store = createStore();
		vi.mocked(store.deleteTrailingMessagesFromMessageByOwner)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const service = buildChatConversationService({ store }) as ChatConversationService & {
			deleteTrailingMessages: (input: {
				conversationId: string;
				messageId: string;
				principal: ResolvedAppPrincipal;
			}) => Promise<{ deleted: true }>;
		};

		await expect(
			service.deleteTrailingMessages({
				conversationId: "conv_01HQ",
				messageId: "msg_01HQ",
				principal: createPrincipal(),
			}),
		).resolves.toEqual({ deleted: true });
		expect(store.deleteTrailingMessagesFromMessageByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			messageId: "msg_01HQ",
			ownerUserId: "user_01HQ",
			updatedAt: expect.any(String),
		});

		await expect(
			service.deleteTrailingMessages({
				conversationId: "conv_01HQ",
				messageId: "msg_missing",
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "message_not_found",
			status: 404,
		});
	});

	it("upserts answer feedback only through owned assistant messages", async () => {
		const store = createStore();
		vi.mocked(store.upsertMessageFeedbackByOwner).mockResolvedValue({
			createdAt: "2026-04-29T08:00:00.000Z",
			feedbackId: "fb_01HQ",
			messageId: "msg_assistant_01HQ",
			reasonCodes: ["wrong_intent"],
			updatedAt: "2026-04-29T08:00:00.000Z",
			vote: "unhelpful",
		});
		const service = buildChatConversationService({
			generateId: () => "fb_01HQ",
			now: () => new Date("2026-04-29T08:00:00.000Z"),
			store,
		}) as ChatConversationService & {
			setMessageFeedback(input: {
				conversationId: string;
				messageId: string;
				principal: ResolvedAppPrincipal;
				reasonCodes?: string[];
				vote: "helpful" | "unhelpful";
			}): Promise<{
				feedback: {
					feedbackId: string;
					messageId: string;
					reasonCodes: string[];
					vote: "helpful" | "unhelpful";
				};
			}>;
		};

		await expect(
			service.setMessageFeedback({
				conversationId: "conv_01HQ",
				messageId: "msg_assistant_01HQ",
				principal: createPrincipal(),
				reasonCodes: ["wrong_intent"],
				vote: "unhelpful",
			}),
		).resolves.toEqual({
			feedback: {
				createdAt: "2026-04-29T08:00:00.000Z",
				feedbackId: "fb_01HQ",
				messageId: "msg_assistant_01HQ",
				reasonCodes: ["wrong_intent"],
				updatedAt: "2026-04-29T08:00:00.000Z",
				vote: "unhelpful",
			},
		});
		expect(store.upsertMessageFeedbackByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			feedbackId: "fb_01HQ",
			messageId: "msg_assistant_01HQ",
			ownerUserId: "user_01HQ",
			reasonCodes: ["wrong_intent"],
			updatedAt: "2026-04-29T08:00:00.000Z",
			vote: "unhelpful",
		});
	});

	it("rejects invalid answer feedback reasons before touching storage", async () => {
		const store = createStore();
		vi.mocked(store.upsertMessageFeedbackByOwner).mockReset();
		const service = buildChatConversationService({ store }) as ChatConversationService & {
			setMessageFeedback(input: {
				conversationId: string;
				messageId: string;
				principal: ResolvedAppPrincipal;
				reasonCodes?: string[];
				vote: "helpful" | "unhelpful";
			}): Promise<unknown>;
		};

		await expect(
			service.setMessageFeedback({
				conversationId: "conv_01HQ",
				messageId: "msg_assistant_01HQ",
				principal: createPrincipal(),
				reasonCodes: ["wrong_intent"],
				vote: "helpful",
			}),
		).rejects.toMatchObject({
			code: "invalid_message_feedback",
			status: 400,
		});
		expect(store.upsertMessageFeedbackByOwner).not.toHaveBeenCalled();
	});

	it("deletes answer feedback through owned assistant messages", async () => {
		const store = createStore();
		vi.mocked(store.deleteMessageFeedbackByOwner)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const service = buildChatConversationService({ store }) as ChatConversationService & {
			deleteMessageFeedback(input: {
				conversationId: string;
				messageId: string;
				principal: ResolvedAppPrincipal;
			}): Promise<{ deleted: true }>;
		};

		await expect(
			service.deleteMessageFeedback({
				conversationId: "conv_01HQ",
				messageId: "msg_assistant_01HQ",
				principal: createPrincipal(),
			}),
		).resolves.toEqual({ deleted: true });
		expect(store.deleteMessageFeedbackByOwner).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			messageId: "msg_assistant_01HQ",
			ownerUserId: "user_01HQ",
		});

		await expect(
			service.deleteMessageFeedback({
				conversationId: "conv_01HQ",
				messageId: "msg_missing",
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "message_feedback_not_found",
			status: 404,
		});
	});
});
