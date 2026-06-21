import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import { hasMatchingInternalSecret, type ResolvedAppPrincipal } from "../../modules/auth";
import { ExecutionControlTransportError } from "../../modules/integration";
import { requireSessionPrincipal } from "../principal";
import {
	buildInternalEvalPrincipalFromRequest,
	createRouteErrorCorrelation,
	readJsonRequestBody,
	resolveWaitUntil,
} from "../request-utils";
import {
	routeErrorResponseWithRouteErrorCorrelation,
	serviceCredentialRequiredResponse,
} from "../responses";
import type { AppRequestScope } from "../types";
import { registerChatRunRoutes } from "./chat-run-routes";
import {
	createAssistantUiDataStreamResponse,
	createChatSseResponse,
	readAssistantUiPrompt,
} from "./chat-stream-responses";

function requireConversationId(conversationId: string | null | undefined) {
	if (conversationId) {
		return conversationId;
	}

	return null;
}

function requireObjectBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "Expected a JSON object request body.",
			retryable: false,
			status: 400,
		});
	}
	return value as Record<string, unknown>;
}

function readFeedbackVote(body: Record<string, unknown>): "helpful" | "unhelpful" {
	const vote = body.vote;
	if (vote === "helpful" || vote === "unhelpful") {
		return vote;
	}

	throw new AppApiRouteError({
		code: "invalid_request",
		message: "vote must be helpful or unhelpful.",
		retryable: false,
		status: 400,
	});
}

function readFeedbackReasonCodes(body: Record<string, unknown>): string[] | undefined {
	if (!("reasonCodes" in body)) {
		return;
	}

	if (
		!Array.isArray(body.reasonCodes) ||
		body.reasonCodes.some((item) => typeof item !== "string")
	) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "reasonCodes must be an array of strings.",
			retryable: false,
			status: 400,
		});
	}

	return body.reasonCodes;
}

function readConversationViewQuery(value: string | undefined): "active" | "archived" | undefined {
	if (value === undefined) {
		return;
	}
	if (value === "active" || value === "archived") {
		return value;
	}
	throw new AppApiRouteError({
		code: "invalid_request",
		message: "view must be active or archived.",
		retryable: false,
		status: 400,
	});
}

function readConversationLimitQuery(value: string | undefined): number | undefined {
	if (value === undefined) {
		return;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "limit must be an integer.",
			retryable: false,
			status: 400,
		});
	}
	return parsed;
}

function readRequiredStringBodyField(body: Record<string, unknown>, fieldName: string): string {
	const value = body[fieldName];
	if (typeof value === "string") {
		return value;
	}
	throw new AppApiRouteError({
		code: "invalid_request",
		message: `${fieldName} is required.`,
		retryable: false,
		status: 400,
	});
}

function routeChatErrorResponse(
	error: unknown,
	routeErrorCorrelation: {
		requestId: string;
		traceId: string;
	},
): Response | null {
	if (error instanceof AppApiRouteError) {
		return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
	}
	if (error instanceof ExecutionControlTransportError) {
		return routeErrorResponseWithRouteErrorCorrelation(
			new AppApiRouteError({
				code: error.code,
				message: error.message,
				retryable: error.retryable,
				status: error.status,
			}),
			routeErrorCorrelation,
		);
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

		const routeErrorCorrelation = createRouteErrorCorrelation();

		try {
			const response = await scope.resolveChatCommandService().submit({
				idempotencyKey: c.req.header("idempotency-key") ?? null,
				payload: await readJsonRequestBody(c.req.raw),
				principal: resolved.principal,
				traceHeaders: scope.telemetry.getTraceHeaders({ request: c.req.raw }),
				waitUntil: resolveWaitUntil(c),
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
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.post("/api/chat/assistant-ui", async (c) => {
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
			const service = scope.resolveChatCommandService();
			if (!service.submitStream) {
				throw new AppApiRouteError({
					code: "dependency_not_ready",
					message: "Chat lifecycle stream is not configured.",
					retryable: true,
					status: 503,
				});
			}

			const assistantRequest = readAssistantUiPrompt(
				requireObjectBody(await readJsonRequestBody(c.req.raw)),
			);
			const iterator = service
				.submitStream({
					idempotencyKey: c.req.header("idempotency-key") ?? null,
					payload: {
						conversationId: assistantRequest.conversationId,
						prompt: assistantRequest.prompt,
					},
					principal: resolved.principal,
					surface: "campus_web",
					traceHeaders: scope.telemetry.getTraceHeaders({ request: c.req.raw }),
					waitUntil: resolveWaitUntil(c),
				})
				[Symbol.asyncIterator]();
			const first = await iterator.next();
			if (first.done) {
				throw new AppApiRouteError({
					code: "empty_lifecycle_stream",
					message: "Chat lifecycle stream ended before emitting a request event.",
					retryable: true,
					status: 502,
				});
			}

			return createAssistantUiDataStreamResponse({
				first: first.value,
				iterator,
				onTerminal: (event) => {
					input.scheduleRequestProjectionDrain?.({
						requestId: event.data.requestId,
						waitUntil: resolveWaitUntil(c),
					});
				},
			});
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.post("/api/chat/requests/stream", async (c) => {
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
			const service = scope.resolveChatCommandService();
			if (!service.submitStream) {
				throw new AppApiRouteError({
					code: "dependency_not_ready",
					message: "Chat lifecycle stream is not configured.",
					retryable: true,
					status: 503,
				});
			}

			const iterator = service
				.submitStream({
					idempotencyKey: c.req.header("idempotency-key") ?? null,
					payload: await readJsonRequestBody(c.req.raw),
					principal: resolved.principal,
					traceHeaders: scope.telemetry.getTraceHeaders({ request: c.req.raw }),
					waitUntil: resolveWaitUntil(c),
				})
				[Symbol.asyncIterator]();
			const first = await iterator.next();
			if (first.done) {
				throw new AppApiRouteError({
					code: "empty_lifecycle_stream",
					message: "Chat lifecycle stream ended before emitting a request event.",
					retryable: true,
					status: 502,
				});
			}

			return createChatSseResponse({
				first: first.value,
				iterator,
				onTerminal: (event) => {
					input.scheduleRequestProjectionDrain?.({
						requestId: event.data.requestId,
						waitUntil: resolveWaitUntil(c),
					});
				},
			});
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.post("/api/internal/evals/chat/requests", async (c) => {
		const scope = input.createRequestScope();
		if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
			return serviceCredentialRequiredResponse();
		}
		const routeErrorCorrelation = createRouteErrorCorrelation();

		try {
			const response = await scope.resolveChatCommandService().submit({
				idempotencyKey: c.req.header("idempotency-key") ?? null,
				payload: await readJsonRequestBody(c.req.raw),
				principal: buildInternalEvalPrincipalFromRequest(c.req.raw),
				surface: "eval_benchmark",
				traceHeaders: scope.telemetry.getTraceHeaders({ request: c.req.raw }),
				waitUntil: resolveWaitUntil(c),
			});

			return jsonResponse(
				{
					answer: response.answer,
					execution: response.execution ?? null,
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
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	registerChatRunRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
		routeChatErrorResponse,
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

		const routeErrorCorrelation = createRouteErrorCorrelation();
		try {
			const response = await scope.resolveChatConversationService().list({
				limit: readConversationLimitQuery(c.req.query("limit")),
				principal: resolved.principal,
				view: readConversationViewQuery(c.req.query("view")),
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
			const response = await scope.resolveChatConversationService().search({
				limit: readConversationLimitQuery(c.req.query("limit")),
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

	input.app.put(
		"/api/chat/conversations/:conversationId/messages/:messageId/feedback",
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

			const routeErrorCorrelation = createRouteErrorCorrelation();
			try {
				const body = requireObjectBody(await readJsonRequestBody(c.req.raw));
				const response = await scope.resolveChatConversationService().setMessageFeedback({
					conversationId: c.req.param("conversationId"),
					messageId: c.req.param("messageId"),
					principal: resolved.principal,
					reasonCodes: readFeedbackReasonCodes(body),
					vote: readFeedbackVote(body),
				});
				return jsonResponse(response);
			} catch (error) {
				if (error instanceof AppApiRouteError) {
					return routeErrorResponseWithRouteErrorCorrelation(error, routeErrorCorrelation);
				}
				throw error;
			}
		},
	);

	input.app.delete(
		"/api/chat/conversations/:conversationId/messages/:messageId/feedback",
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

			await scope.resolveChatConversationService().deleteMessageFeedback({
				conversationId: c.req.param("conversationId"),
				messageId: c.req.param("messageId"),
				principal: resolved.principal,
			});
			return new Response(null, { status: 204 });
		},
	);

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
