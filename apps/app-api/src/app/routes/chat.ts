import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import { hasMatchingInternalSecret, type ResolvedAppPrincipal } from "../../modules/auth";
import { ExecutionControlTransportError } from "../../modules/integration";
import type { ChatCommandStreamEvent } from "../../modules/runtime-command";
import type { RuntimeRunEventProjection, RuntimeRunSummary } from "../../modules/runtime-run";
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

function readRunCancelReason(body: Record<string, unknown>): string {
	const reason = body.reason;
	if (typeof reason === "string" && reason.trim()) {
		return reason.trim();
	}

	throw new AppApiRouteError({
		code: "invalid_request",
		message: "reason is required.",
		retryable: false,
		status: 400,
	});
}

function readAfterSequenceQuery(value: string | undefined): number | undefined {
	if (value === undefined) {
		return;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "after_sequence must be a non-negative integer.",
			retryable: false,
			status: 400,
		});
	}
	const parsed = Number(trimmed);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "after_sequence must be a non-negative integer.",
			retryable: false,
			status: 400,
		});
	}
	return parsed;
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

function encodeSseMessage(input: { data: unknown; event: string }): Uint8Array {
	return new TextEncoder().encode(`event: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`);
}

function encodeSseEvent(event: ChatCommandStreamEvent): Uint8Array {
	return encodeSseMessage(event);
}

function isTerminalChatStreamEvent(event: ChatCommandStreamEvent): boolean {
	return (
		event.event === "request.completed" ||
		event.event === "request.failed" ||
		event.event === "request.cancelled"
	);
}

function createChatSseResponse(input: {
	first: ChatCommandStreamEvent;
	iterator: AsyncIterator<ChatCommandStreamEvent>;
	onTerminal?: (event: ChatCommandStreamEvent) => void;
}): Response {
	const stream = new ReadableStream<Uint8Array>({
		async cancel() {
			await input.iterator.return?.();
		},
		async start(controller) {
			async function emit(event: ChatCommandStreamEvent) {
				if (isTerminalChatStreamEvent(event)) {
					input.onTerminal?.(event);
				}
				controller.enqueue(encodeSseEvent(event));
			}

			try {
				await emit(input.first);
				while (true) {
					const next = await input.iterator.next();
					if (next.done) {
						break;
					}
					await emit(next.value);
				}
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"cache-control": "no-store",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
			"x-request-id": input.first.data.requestId,
			"x-trace-id": input.first.data.traceId,
		},
		status: 200,
	});
}

function createRunEventsSseResponse(input: {
	events: AsyncIterable<RuntimeRunEventProjection>;
	run: RuntimeRunSummary;
}): Response {
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of input.events) {
					controller.enqueue(
						encodeSseMessage({
							data: event,
							event: event.eventType,
						}),
					);
				}
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"cache-control": "no-store",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
			"x-request-id": input.run.requestId,
			"x-run-id": input.run.runId,
			"x-trace-id": input.run.traceId,
		},
		status: 200,
	});
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
				waitUntil: resolveWaitUntil(c),
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
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.get("/api/chat/runs/:runId", async (c) => {
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
			const response = await scope.resolveRuntimeRunService().getStatus({
				principal: resolved.principal,
				runId: c.req.param("runId"),
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

	input.app.get("/api/chat/runs/:runId/events", async (c) => {
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
			const response = await scope.resolveRuntimeRunService().listEvents({
				afterSequence: readAfterSequenceQuery(c.req.query("after_sequence")),
				principal: resolved.principal,
				runId: c.req.param("runId"),
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

	input.app.get("/api/chat/runs/:runId/events/stream", async (c) => {
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
			const runtimeRunService = scope.resolveRuntimeRunService();
			const runStatus = await runtimeRunService.getStatus({
				principal: resolved.principal,
				runId: c.req.param("runId"),
			});
			const events = runtimeRunService.subscribeEvents({
				afterSequence: readAfterSequenceQuery(c.req.query("after_sequence")),
				principal: resolved.principal,
				runId: c.req.param("runId"),
			});
			return createRunEventsSseResponse({
				events,
				run: runStatus.run,
			});
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.post("/api/chat/runs/:runId/cancel", async (c) => {
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
			const response = await scope.resolveRuntimeRunService().cancel({
				principal: resolved.principal,
				reason: readRunCancelReason(body),
				runId: c.req.param("runId"),
			});
			return jsonResponse(response, { status: 202 });
		} catch (error) {
			const response = routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
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
