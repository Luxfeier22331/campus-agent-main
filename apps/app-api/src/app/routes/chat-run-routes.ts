import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { ChatCommandStreamEvent } from "../../modules/runtime-command";
import type { RuntimeRunEventProjection, RuntimeRunSummary } from "../../modules/runtime-run";
import { requireSessionPrincipal } from "../principal";
import {
	createRouteErrorCorrelation,
	readJsonRequestBody,
	resolveWaitUntil,
} from "../request-utils";
import type { AppRequestScope } from "../types";

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

function encodeSseMessage(input: { data: unknown; event: string }): Uint8Array {
	return new TextEncoder().encode(`event: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`);
}

function encodeSseComment(comment: string): Uint8Array {
	return new TextEncoder().encode(`: ${comment}\n\n`);
}

function createRunEventsSseResponse(input: {
	events: AsyncIterable<RuntimeRunEventProjection>;
	onTerminal?: ((event: ChatCommandStreamEvent) => Promise<void> | void) | undefined;
	run: RuntimeRunSummary;
}): Response {
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
			try {
				controller.enqueue(encodeSseComment("keepalive"));
				heartbeatInterval = setInterval(() => {
					controller.enqueue(encodeSseComment("keepalive"));
				}, 15_000);
				for await (const event of input.events) {
					const productEvent = toChatRunResumeStreamEvent({
						event,
						run: input.run,
					});
					if (productEvent) {
						if (
							productEvent.event === "request.completed" ||
							productEvent.event === "request.cancelled" ||
							productEvent.event === "request.failed"
						) {
							await input.onTerminal?.(productEvent);
						}
						controller.enqueue(encodeSseMessage(productEvent));
					}
				}
			} finally {
				if (heartbeatInterval) {
					clearInterval(heartbeatInterval);
				}
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

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
	const value = payload[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function getBooleanPayloadValue(payload: Record<string, unknown>, key: string): boolean | null {
	const value = payload[key];
	return typeof value === "boolean" ? value : null;
}

function getPayloadRecordValue(
	payload: Record<string, unknown>,
	key: string,
): Record<string, unknown> | null {
	const value = payload[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function resolveRunEventRequestId(input: {
	event: RuntimeRunEventProjection;
	run: RuntimeRunSummary;
}): string {
	return getStringPayloadValue(input.event.payload, "request_id") ?? input.run.requestId;
}

function resolveRunEventTraceId(input: {
	event: RuntimeRunEventProjection;
	run: RuntimeRunSummary;
}): string {
	return getStringPayloadValue(input.event.payload, "trace_id") ?? input.run.traceId;
}

function toChatRunResumeStreamEvent(input: {
	event: RuntimeRunEventProjection;
	run: RuntimeRunSummary;
}): ChatCommandStreamEvent | null {
	const requestId = resolveRunEventRequestId(input);
	const traceId = resolveRunEventTraceId(input);
	const baseData = {
		occurredAt: input.event.occurredAt,
		requestId,
		runId: input.run.runId,
		sequence: input.event.sequence,
		traceId,
	};
	if (input.event.eventType === "execution.queued" || input.event.eventType === "run.queued") {
		return {
			data: {
				...baseData,
				status: "queued",
			},
			event: "execution.queued",
		};
	}
	if (
		input.event.eventType === "execution.running" ||
		input.event.eventType === "run.started" ||
		input.event.eventType === "run.running"
	) {
		return {
			data: {
				...baseData,
				status: getStringPayloadValue(input.event.payload, "status") ?? "running",
			},
			event: "execution.running",
		};
	}
	if (
		input.event.eventType === "finalization.completed" ||
		input.event.eventType === "run.completed"
	) {
		return {
			data: {
				...baseData,
				status: "completed",
			},
			event: "request.completed",
		};
	}
	if (input.event.eventType === "run.canceled") {
		return {
			data: {
				...baseData,
				status: "cancelled",
			},
			event: "request.cancelled",
		};
	}
	if (input.event.eventType === "run.failed" || input.event.eventType === "run.expired") {
		const terminalError = getPayloadRecordValue(input.event.payload, "error");
		return {
			data: {
				...baseData,
				error: {
					code:
						(terminalError ? getStringPayloadValue(terminalError, "code") : null) ??
						getStringPayloadValue(input.event.payload, "code") ??
						(input.event.eventType === "run.expired" ? "run_expired" : "run_failed"),
					message:
						(terminalError ? getStringPayloadValue(terminalError, "message") : null) ??
						getStringPayloadValue(input.event.payload, "message") ??
						(input.event.eventType === "run.expired"
							? "The request expired before it completed."
							: "The request failed before it completed."),
					retryable:
						(terminalError ? getBooleanPayloadValue(terminalError, "retryable") : null) ??
						getBooleanPayloadValue(input.event.payload, "retryable") ??
						true,
				},
				status: input.event.eventType === "run.expired" ? "expired" : "failed",
			},
			event: "request.failed",
		};
	}
	return null;
}

export const __chatRunRoutesTestables = {
	toChatRunResumeStreamEvent,
};

export function registerChatRunRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<import("../../modules/auth").ResolvedAppPrincipal | null>;
	scheduleRequestProjectionDrain?: (value: {
		requestId: string;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	}) => void;
	routeChatErrorResponse(
		error: unknown,
		routeErrorCorrelation: {
			requestId: string;
			traceId: string;
		},
	): Response | null;
}) {
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
			const response = input.routeChatErrorResponse(error, routeErrorCorrelation);
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
			const response = input.routeChatErrorResponse(error, routeErrorCorrelation);
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
				onTerminal: async () => {
					await scope.resolveChatCommandService().reconcileDurableCloseouts?.({
						limit: 1,
						runId: runStatus.run.runId,
						startedBefore: new Date().toISOString(),
					});
					input.scheduleRequestProjectionDrain?.({
						requestId: runStatus.run.requestId,
						waitUntil: resolveWaitUntil(c),
					});
				},
				run: runStatus.run,
			});
		} catch (error) {
			const response = input.routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});

	input.app.get("/api/chat/runs/:runId/steps", async (c) => {
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
			const response = await scope.resolveRuntimeRunService().listSteps({
				principal: resolved.principal,
				runId: c.req.param("runId"),
			});
			return jsonResponse(response);
		} catch (error) {
			const response = input.routeChatErrorResponse(error, routeErrorCorrelation);
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
			const response = input.routeChatErrorResponse(error, routeErrorCorrelation);
			if (response) {
				return response;
			}
			throw error;
		}
	});
}
