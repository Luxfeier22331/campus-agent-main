// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type {
	ChatConversationResponse,
	ChatConversationService,
	ChatConversationSummaryResponse,
} from "../src/modules/chat";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	CLUSTER_PRIVATE_BASE_URL: "https://execution-control.internal",
	EDGE_INGRESS_SHARED_SECRET: "shared-secret",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("conversation principal dependency failures", () => {
	it("preserves typed principal errors", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockRejectedValue(
				new AppApiRouteError({
					code: "access_denied",
					message: "Access denied.",
					retryable: false,
					status: 403,
				}),
			),
		});
		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations"),
		);
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			error: { code: "access_denied", message: "Access denied.", retryable: false },
		});
	});
	it("does not misreport a connection timeout as missing configuration or create a conversation", async () => {
		const { service } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi
				.fn()
				.mockRejectedValue(new Error("Connection terminated due to connection timeout")),
		});
		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			error: {
				code: "dependency_not_ready",
				message: "Authentication service is temporarily unavailable.",
				retryable: true,
			},
		});
		expect(service.createDraft).not.toHaveBeenCalled();
	});
});

function createConversationService() {
	const conversations: ChatConversationSummaryResponse[] = [
		{
			archivedAt: null,
			createdAt: "2026-03-28T08:00:00.000Z",
			id: "conv_01HQ",
			pinnedAt: "2026-03-28T08:02:00.000Z",
			title: "图书馆开放时间",
			updatedAt: "2026-03-28T08:01:00.000Z",
		},
	];
	const searchConversations = conversations.map((conversation) => ({
		...conversation,
		matchSnippet: null,
	}));
	const conversation: ChatConversationResponse = {
		activeRequestId: null,
		createdAt: "2026-03-28T08:00:00.000Z",
		id: "conv_01HQ",
		messages: [
			{
				conversationId: "conv_01HQ",
				createdAt: "2026-03-28T08:00:30.000Z",
				id: "msg_01HQ",
				kind: null,
				requestId: null,
				retryable: null,
				role: "user",
				structuredParts: [],
				text: "图书馆开放到几点？",
			},
		],
		title: "图书馆开放时间",
		updatedAt: "2026-03-28T08:01:00.000Z",
	};

	const deleteTrailingMessages = vi.fn().mockResolvedValue({ deleted: true });
	const service: ChatConversationService & {
		deleteTrailingMessages: typeof deleteTrailingMessages;
	} = {
		createDraft: vi.fn().mockResolvedValue({ conversation }),
		deleteAll: vi.fn().mockResolvedValue({ deletedCount: 1 }),
		deleteById: vi.fn().mockResolvedValue({ deleted: true }),
		deleteMessageFeedback: vi.fn(),
		deleteTrailingMessages,
		archive: vi.fn().mockResolvedValue({ conversation: conversations[0] }),
		getById: vi.fn().mockResolvedValue({ conversation }),
		listHistoryPage: vi.fn().mockResolvedValue({
			chats: [
				{
					createdAt: "2026-03-28T08:00:00.000Z",
					id: "conv_01HQ",
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:01:00.000Z",
					visibility: "private",
				},
			],
			hasMore: false,
		}),
		list: vi.fn().mockResolvedValue({ conversations }),
		pin: vi.fn().mockResolvedValue({ conversation: conversations[0] }),
		rename: vi.fn().mockResolvedValue({ conversation: conversations[0] }),
		search: vi.fn().mockResolvedValue({ query: "图书馆", conversations: searchConversations }),
		setMessageFeedback: vi.fn(),
		unarchive: vi.fn().mockResolvedValue({ conversation: conversations[0] }),
		unpin: vi.fn().mockResolvedValue({ conversation: conversations[0] }),
	};

	return {
		conversation,
		conversations,
		deleteTrailingMessages,
		service,
	};
}

describe("chat conversation routes", () => {
	it("lists current user conversations through the shared chat service", async () => {
		const { service, conversations } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ conversations });
		expect(service.list).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("passes view and limit options when listing conversations", async () => {
		const { service, conversations } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations?view=archived&limit=25"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ conversations });
		expect(service.list).toHaveBeenCalledWith({
			limit: 25,
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
			view: "archived",
		});
	});

	it("searches conversations through the product search route", async () => {
		const { service } = createConversationService();
		const searchConversations = [
			{
				archivedAt: null,
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "conv_01HQ",
				matchSnippet: null,
				pinnedAt: "2026-03-28T08:02:00.000Z",
				title: "图书馆开放时间",
				updatedAt: "2026-03-28T08:01:00.000Z",
			},
		];
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/search?q=图书馆&limit=10"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			query: "图书馆",
			conversations: [{ ...searchConversations[0] }],
		});
		expect(service.search).toHaveBeenCalledWith({
			limit: 10,
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
			query: "图书馆",
			view: "active",
		});
	});

	it("renames, pins, unpins, archives, and unarchives owned conversations", async () => {
		const { service, conversations } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const renameResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_01HQ", {
				body: JSON.stringify({ title: "新的会话标题" }),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		const pinResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_01HQ/pin", {
				method: "POST",
			}),
		);
		const unpinResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_01HQ/pin", {
				method: "DELETE",
			}),
		);
		const archiveResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_01HQ/archive", {
				method: "POST",
			}),
		);
		const unarchiveResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_01HQ/archive", {
				method: "DELETE",
			}),
		);

		for (const response of [
			renameResponse,
			pinResponse,
			unpinResponse,
			archiveResponse,
			unarchiveResponse,
		]) {
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ conversation: conversations[0] });
		}
		expect(service.rename).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.any(Object),
			title: "新的会话标题",
		});
		expect(service.pin).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.any(Object),
		});
		expect(service.unpin).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.any(Object),
		});
		expect(service.archive).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.any(Object),
		});
		expect(service.unarchive).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.any(Object),
		});
	});

	it("creates a draft conversation without requiring a separate request body contract", async () => {
		const { service, conversation } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations", {
				method: "POST",
			}),
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ conversation });
		expect(service.createDraft).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("returns conversation detail for the current user", async () => {
		const { service, conversation } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_01HQ"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ conversation });
		expect(service.getById).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("routes answer feedback PUT and DELETE through the shared chat service", async () => {
		const { service } = createConversationService();
		const setMessageFeedback = vi.fn().mockResolvedValue({
			feedback: {
				createdAt: "2026-04-29T08:00:00.000Z",
				feedbackId: "fb_01HQ",
				messageId: "msg_assistant_01HQ",
				reasonCodes: ["wrong_intent"],
				updatedAt: "2026-04-29T08:00:00.000Z",
				vote: "unhelpful",
			},
		});
		const deleteMessageFeedback = vi.fn().mockResolvedValue({ deleted: true });
		const app = createApp(env, {
			chatConversationService: {
				...service,
				deleteMessageFeedback,
				setMessageFeedback,
			} as ChatConversationService & {
				deleteMessageFeedback: typeof deleteMessageFeedback;
				setMessageFeedback: typeof setMessageFeedback;
			},
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const putResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
				{
					body: JSON.stringify({
						reasonCodes: ["wrong_intent"],
						vote: "unhelpful",
					}),
					headers: {
						"content-type": "application/json",
					},
					method: "PUT",
				},
			),
		);
		const deleteResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
				{
					method: "DELETE",
				},
			),
		);

		expect(putResponse.status).toBe(200);
		await expect(putResponse.json()).resolves.toEqual({
			feedback: {
				createdAt: "2026-04-29T08:00:00.000Z",
				feedbackId: "fb_01HQ",
				messageId: "msg_assistant_01HQ",
				reasonCodes: ["wrong_intent"],
				updatedAt: "2026-04-29T08:00:00.000Z",
				vote: "unhelpful",
			},
		});
		expect(deleteResponse.status).toBe(204);
		expect(setMessageFeedback).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			messageId: "msg_assistant_01HQ",
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
			reasonCodes: ["wrong_intent"],
			vote: "unhelpful",
		});
		expect(deleteMessageFeedback).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			messageId: "msg_assistant_01HQ",
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
		});
	});

	it("rejects malformed answer feedback request bodies", async () => {
		const { service } = createConversationService();
		const setMessageFeedback = vi.fn();
		const app = createApp(env, {
			chatConversationService: {
				...service,
				setMessageFeedback,
			} as ChatConversationService & {
				setMessageFeedback: typeof setMessageFeedback;
			},
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
				{
					body: JSON.stringify({
						vote: "maybe",
					}),
					headers: {
						"content-type": "application/json",
					},
					method: "PUT",
				},
			),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "invalid_request",
				message: "vote must be helpful or unhelpful.",
			},
		});
		expect(setMessageFeedback).not.toHaveBeenCalled();
	});

	it("serves vendor-compatible paginated history through /api/history", async () => {
		const { service } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(new Request("https://app-api.internal/api/history?limit=20"));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			chats: [
				{
					createdAt: "2026-03-28T08:00:00.000Z",
					id: "conv_01HQ",
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:01:00.000Z",
					visibility: "private",
				},
			],
			hasMore: false,
		});
		expect(service.listHistoryPage).toHaveBeenCalledWith({
			endingBeforeConversationId: null,
			limit: 20,
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("deletes a single chat through the vendor-compatible /api/chat?id= route", async () => {
		const { service } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat?id=conv_01HQ", {
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ deleted: true });
		expect(service.deleteById).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("deletes all chats through the vendor-compatible /api/history route", async () => {
		const { service } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/history", {
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ deletedCount: 1 });
		expect(service.deleteAll).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("deletes trailing messages from an owned conversation through the chat edit route", async () => {
		const { service, deleteTrailingMessages } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/conversations/conv_01HQ/messages/msg_01HQ/trailing",
				{
					method: "DELETE",
				},
			),
		);

		expect(response.status).toBe(204);
		expect(deleteTrailingMessages).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			messageId: "msg_01HQ",
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("fails closed when no session principal is available on chat conversation routes", async () => {
		const { service } = createConversationService();
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(null),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations"),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "session_required",
				details: null,
				message: "Sign in required.",
				requestId: null,
				retryable: false,
			},
		});
	});

	it("maps chat service ownership errors onto the shared error envelope", async () => {
		const { service } = createConversationService();
		service.getById = vi.fn().mockRejectedValue(
			new AppApiRouteError({
				code: "conversation_not_found",
				message: "Conversation not found.",
				retryable: false,
				status: 404,
			}),
		);
		const app = createApp(env, {
			chatConversationService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations/conv_missing"),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "conversation_not_found",
				details: null,
				message: "Conversation not found.",
				requestId: null,
				retryable: false,
			},
		});
	});
});
