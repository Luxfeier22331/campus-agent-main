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
			operator: false,
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
		deleteTrailingMessagesFromMessageByOwner: vi.fn(),
		getConversationByOwner: vi.fn(),
		getConversationDetailByOwner: vi.fn(),
		listConversationSummariesPageByOwner: vi.fn(),
		listConversationSummariesByOwner: vi.fn(),
	} as ChatConversationStore;
}

describe("chat conversation service", () => {
	it("lists chat conversation summaries for chat-enabled campus principals only", async () => {
		const store = createStore();
		store.listConversationSummariesByOwner = vi.fn().mockResolvedValue([
			{
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
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
						operator: true,
					},
					principal: {
						displayName: "Ops Team",
						email: "ops@example.com",
						principalId: "ops@example.com",
						type: "operator",
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
					createdAt: "2026-03-28T08:00:00.000Z",
					id: "conv_01HQ",
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:01:00.000Z",
				},
			],
		});
		expect(store.listConversationSummariesByOwner).toHaveBeenCalledWith("user_01HQ");
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
		store.getConversationDetailByOwner = vi
			.fn()
			.mockResolvedValueOnce({
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
				messages: [],
				ownerUserId: "user_01HQ",
				title: "图书馆开放时间",
				updatedAt: "2026-03-28T08:01:00.000Z",
			})
			.mockResolvedValueOnce(null);
		const service = buildChatConversationService({ store });

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
		const store = createStore() as ChatConversationStore & {
			deleteTrailingMessagesFromMessageByOwner: ReturnType<typeof vi.fn>;
		};
		store.deleteTrailingMessagesFromMessageByOwner = vi
			.fn()
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
});
