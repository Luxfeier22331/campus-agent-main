import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import { hasMatchingInternalSecret, type ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import {
	buildInternalEvalPrincipalFromRequest,
	createFallbackCorrelation,
	readJsonRequestBody,
	resolveWaitUntil,
} from "../request-utils";
import {
	routeErrorResponseWithFallbackCorrelation,
	serviceCredentialRequiredResponse,
} from "../responses";
import type { AppRequestScope } from "../types";

function requireConversationId(conversationId: string | null | undefined) {
	if (conversationId) {
		return conversationId;
	}

	return null;
}

export function registerChatRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	scheduleRequestProjectionDrain?: (value: {
		requestId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) => void;
}) {
	input.app.post("/api/chat/requests", async (c) => {
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

		const fallbackCorrelation = createFallbackCorrelation();

		try {
			const response = await scope.resolveChatCommandService().submit({
				idempotencyKey: c.req.header("idempotency-key") ?? null,
				payload: await readJsonRequestBody(c.req.raw),
				principal: resolved.principal,
			});
			input.scheduleRequestProjectionDrain?.({
				requestId: response.requestId,
				waitUntil: resolveWaitUntil(c),
			});

			return jsonResponse(
				{
					answer: response.answer,
				},
				{
					headers: {
						"x-request-id": response.requestId,
						"x-trace-id": response.traceId,
					},
					status: 200,
				},
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithFallbackCorrelation(error, fallbackCorrelation);
			}
			throw error;
		}
	});

	input.app.post("/api/internal/evals/chat/requests", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}
		const fallbackCorrelation = createFallbackCorrelation();

		try {
			const response = await scope.resolveChatCommandService().submit({
				idempotencyKey: c.req.header("idempotency-key") ?? null,
				payload: await readJsonRequestBody(c.req.raw),
				principal: buildInternalEvalPrincipalFromRequest(c.req.raw),
				surface: "eval_benchmark",
			});

			return jsonResponse(
				{
					answer: response.answer,
					supervisor: response.supervisor ?? null,
				},
				{
					headers: {
						"x-request-id": response.requestId,
						"x-trace-id": response.traceId,
					},
					status: 200,
				},
			);
		} catch (error) {
			if (error instanceof AppApiRouteError) {
				return routeErrorResponseWithFallbackCorrelation(error, fallbackCorrelation);
			}
			throw error;
		}
	});

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

		const response = await scope.resolveChatConversationService().list({
			principal: resolved.principal,
		});
		return jsonResponse(response);
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

	input.app.delete(
		"/api/chat/conversations/:conversationId/messages/:messageId/trailing",
		async (c) => {
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

			await scope.resolveChatConversationService().deleteTrailingMessages({
				conversationId: c.req.param("conversationId"),
				messageId: c.req.param("messageId"),
				principal: resolved.principal,
			});
			return new Response(null, { status: 204 });
		},
	);

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
						traceId: null,
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
