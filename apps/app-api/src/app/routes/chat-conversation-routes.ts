import { jsonResponse } from "../../http";
import { requireSessionPrincipal } from "../principal";
import { createRouteErrorCorrelation, readJsonRequestBody } from "../request-utils";
import {
	readConversationLimitQuery,
	readConversationViewQuery,
	readRequiredStringBodyField,
	requireConversationId,
	requireObjectBody,
	routeChatErrorResponse,
} from "./chat-route-support";
import type { ChatRouteRegistrationInput } from "./chat-route-types";

export function registerChatConversationRoutes(input: ChatRouteRegistrationInput) {
	input.app.get("/api/chat/conversations", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const limit = readConversationLimitQuery(c.req.query("limit"));
			const view = readConversationViewQuery(c.req.query("view"));
			const response = await scope.resolveChatConversationService().list({
				...(limit === undefined ? {} : { limit }),
				principal: resolved.principal,
				...(view ? { view } : {}),
			});
			return jsonResponse(response);
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.get("/api/history", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const limitParam = c.req.query("limit");
		const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 20;
		const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

		const response = await scope.resolveChatConversationService().listHistoryPage({
			endingBeforeConversationId: c.req.query("ending_before") ?? null,
			limit,
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.post("/api/chat/conversations", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().createDraft({
			principal: resolved.principal,
		});
		return jsonResponse(response, { status: 201 });
	});

	input.app.get("/api/chat/conversations/search", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const limit = readConversationLimitQuery(c.req.query("limit"));
			const response = await scope.resolveChatConversationService().search({
				...(limit === undefined ? {} : { limit }),
				principal: resolved.principal,
				query: c.req.query("q") ?? "",
				view: readConversationViewQuery(c.req.query("view")) ?? "active",
			});
			return jsonResponse(response);
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.delete("/api/history", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().deleteAll({
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.get("/api/chat/conversations/:conversationId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().getById({
			conversationId: c.req.param("conversationId"),
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.patch("/api/chat/conversations/:conversationId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
			const response = await scope.resolveChatConversationService().rename({
				conversationId: c.req.param("conversationId"),
				principal: resolved.principal,
				title: readRequiredStringBodyField(body, "title"),
			});
			return jsonResponse(response);
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.delete("/api/chat/conversations/:conversationId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().deleteById({
			conversationId: c.req.param("conversationId"),
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.post("/api/chat/conversations/:conversationId/archive", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().archive({
			conversationId: c.req.param("conversationId"),
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.delete("/api/chat/conversations/:conversationId/archive", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().unarchive({
			conversationId: c.req.param("conversationId"),
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.post("/api/chat/conversations/:conversationId/pin", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().pin({
			conversationId: c.req.param("conversationId"),
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.delete("/api/chat/conversations/:conversationId/pin", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const response = await scope.resolveChatConversationService().unpin({
			conversationId: c.req.param("conversationId"),
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});

	input.app.delete("/api/chat", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		const conversationId = requireConversationId(c.req.query("id"));
		if (!conversationId) {
			return jsonResponse(
				{
					error: {
						code: "conversation_id_required",
						details: null,
						message: "Conversation id is required.",
						requestId: null,
						retryable: false,
					},
				},
				{ status: 400 },
			);
		}

		const response = await scope.resolveChatConversationService().deleteById({
			conversationId,
			principal: resolved.principal,
		});
		return jsonResponse(response);
	});
}
