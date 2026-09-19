import { z } from "zod";
import { createIdempotencyKey, UnauthorizedError } from "@/platform/api/client";
import {
	ChatStreamRequestError,
	createChatStreamRequestError,
	invalidRunStatusResponse,
} from "./chat-stream-errors";
import { readProductSse } from "./chat-stream-protocol";
import type { ChatRequestStreamEvent } from "./model";

const RUN_STATUS_REQUEST_TIMEOUT_MS = 5_000;
const nonEmptyString = z.string().min(1);
const nullableTimestamp = nonEmptyString.nullable();
const runSummarySchema = z.object({
	acceptedAt: nonEmptyString.optional(),
	completedAt: nullableTimestamp.optional(),
	conversationId: nonEmptyString,
	durationMs: z.number().int().nonnegative().nullable().optional(),
	phase: z.enum([
		"created",
		"queued",
		"admitted",
		"running",
		"streaming",
		"completed",
		"failed",
		"canceled",
		"expired",
	]),
	requestId: nonEmptyString,
	startedAt: nullableTimestamp.optional(),
	status: nonEmptyString,
	terminalReason: nonEmptyString.optional(),
});
const runStatusResponseSchema = z.object({
	run: runSummarySchema,
});
const productRunEventSchema = z.object({
	eventType: z.enum([
		"answer.delta",
		"retrieval.status",
		"execution.phase",
		"execution.queued",
		"execution.running",
		"request.cancelled",
		"request.completed",
		"request.failed",
	]),
	occurredAt: nonEmptyString,
	payload: z.record(z.string(), z.unknown()),
	requestId: nonEmptyString,
	sequence: z.number().int().positive(),
});
const runEventsResponseSchema = z.object({
	events: z.array(productRunEventSchema),
	nextSequence: z.number().int().nonnegative(),
	run: runSummarySchema,
});

export type ChatRunPhase =
	| "created"
	| "queued"
	| "admitted"
	| "running"
	| "streaming"
	| "completed"
	| "failed"
	| "canceled"
	| "expired";

export interface ChatRunStatus {
	acceptedAt: string;
	completedAt: string | null;
	conversationId: string;
	durationMs: number | null;
	phase: ChatRunPhase;
	requestId: string;
	startedAt: string | null;
	status: string;
	terminalReason?: string;
}

export async function cancelRun(requestId: string): Promise<ChatRunStatus> {
	const response = await fetch(`/api/chat/requests/${encodeURIComponent(requestId)}/cancel`, {
		body: JSON.stringify({ reason: "user_requested" }),
		credentials: "same-origin",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		method: "POST",
	});
	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw await createChatStreamRequestError(response);
	}
	const payload = (await response.json()) as unknown;
	const parsed = runStatusResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw invalidRunStatusResponse(response.status);
	}
	return normalizeRunStatus(parsed.data.run);
}

export async function getRunStatus(input: {
	requestId: string;
	signal?: AbortSignal;
}): Promise<ChatRunStatus> {
	const requestController = new AbortController();
	const abortFromCaller = () => requestController.abort(input.signal?.reason);
	if (input.signal?.aborted) {
		abortFromCaller();
	} else {
		input.signal?.addEventListener("abort", abortFromCaller, { once: true });
	}
	let timedOut = false;
	const timeoutId = globalThis.setTimeout(() => {
		timedOut = true;
		requestController.abort(new DOMException("Run status request timed out.", "TimeoutError"));
	}, RUN_STATUS_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`/api/chat/requests/${encodeURIComponent(input.requestId)}`, {
			credentials: "same-origin",
			headers: { accept: "application/json" },
			method: "GET",
			signal: requestController.signal,
		});
		if (response.status === 401) {
			throw new UnauthorizedError();
		}
		if (!response.ok) {
			throw await createChatStreamRequestError(response);
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			if (requestController.signal.aborted) {
				throw error;
			}
			throw invalidRunStatusResponse(response.status);
		}
		const parsed = runStatusResponseSchema.safeParse(payload);
		if (!parsed.success) {
			throw invalidRunStatusResponse(response.status);
		}
		return normalizeRunStatus(parsed.data.run);
	} catch (error) {
		if (timedOut) {
			throw new ChatStreamRequestError({
				code: "request_status_timeout",
				message: "回答状态查询超时。",
				retryable: true,
			});
		}
		throw error;
	} finally {
		globalThis.clearTimeout(timeoutId);
		input.signal?.removeEventListener("abort", abortFromCaller);
	}
}

function normalizeRunStatus(run: z.infer<typeof runSummarySchema>): ChatRunStatus {
	return {
		acceptedAt: run.acceptedAt ?? new Date().toISOString(),
		completedAt: run.completedAt ?? null,
		conversationId: run.conversationId,
		durationMs: run.durationMs ?? null,
		phase: run.phase,
		requestId: run.requestId,
		startedAt: run.startedAt ?? null,
		status: run.status,
		...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
	};
}

function productEventToStreamEvent(
	event: z.infer<typeof productRunEventSchema>,
): ChatRequestStreamEvent | null {
	const payload = event.payload;
	const base = {
		occurredAt: event.occurredAt,
		requestId: event.requestId,
		sequence: event.sequence,
	};
	switch (event.eventType) {
		case "execution.queued":
			return { data: { ...base, status: "queued" }, event: "execution.queued" };
		case "execution.running":
			return { data: { ...base, status: "running" }, event: "execution.running" };
		case "retrieval.status":
			if (
				payload.source !== "campus" ||
				typeof payload.status !== "string" ||
				!["started", "completed", "no_match", "failed", "canceled"].includes(payload.status)
			) {
				return null;
			}
			return {
				event: "retrieval.status",
				data: { ...base, source: payload.source, status: payload.status },
			};
		case "execution.phase":
			if (
				payload.phase !== "preparing" &&
				payload.phase !== "generating" &&
				payload.phase !== "finalizing"
			) {
				return null;
			}
			return {
				data: { ...base, phase: payload.phase, status: "running" },
				event: "execution.phase",
			};
		case "answer.delta":
			if (
				typeof payload.delta !== "string" ||
				!payload.delta ||
				typeof payload.message_id !== "string"
			) {
				return null;
			}
			return {
				data: {
					...base,
					delta: payload.delta,
					messageId: payload.message_id,
					status: "streaming",
				},
				event: "answer.delta",
			};
		case "request.completed":
			return { data: { ...base, status: "completed" }, event: "request.completed" };
		case "request.cancelled":
			return { data: { ...base, status: "cancelled" }, event: "request.cancelled" };
		case "request.failed": {
			const errorRecord = payload.error;
			const error =
				errorRecord && typeof errorRecord === "object" && !Array.isArray(errorRecord)
					? (errorRecord as Record<string, unknown>)
					: null;
			if (
				!error ||
				typeof error.code !== "string" ||
				!error.code.trim() ||
				typeof error.message !== "string" ||
				!error.message.trim() ||
				typeof error.retryable !== "boolean"
			) {
				throw invalidRunStatusResponse(200);
			}
			return {
				data: {
					...base,
					error: {
						code: error.code,
						message: error.message,
						retryable: error.retryable,
					},
					status: "failed",
				},
				event: "request.failed",
			};
		}
		default:
			return null;
	}
}

export async function getRunEvents(input: {
	afterSequence?: number;
	requestId: string;
	signal?: AbortSignal;
}): Promise<{ events: ChatRequestStreamEvent[]; nextSequence: number; run: ChatRunStatus }> {
	const params = new URLSearchParams();
	if (input.afterSequence !== undefined) {
		params.set("after_sequence", String(input.afterSequence));
	}
	const suffix = params.size > 0 ? `?${params.toString()}` : "";
	const response = await fetch(
		`/api/chat/requests/${encodeURIComponent(input.requestId)}/events${suffix}`,
		{
			credentials: "same-origin",
			headers: { accept: "application/json" },
			method: "GET",
			...(input.signal ? { signal: input.signal } : {}),
		},
	);
	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw await createChatStreamRequestError(response);
	}
	const payload = (await response.json()) as unknown;
	const parsed = runEventsResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw invalidRunStatusResponse(response.status);
	}
	const run = normalizeRunStatus(parsed.data.run);
	return {
		events: parsed.data.events
			.map((event) => productEventToStreamEvent(event))
			.filter((event): event is ChatRequestStreamEvent => event !== null),
		nextSequence: parsed.data.nextSequence,
		run,
	};
}

export async function* submitChatRequestStream(input: {
	conversationId?: string;
	idempotencyKey?: string;
	prompt: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRequestStreamEvent> {
	const body = input.conversationId?.trim()
		? { conversationId: input.conversationId, prompt: input.prompt.trim() }
		: { prompt: input.prompt.trim() };
	const response = await fetch("/api/chat/requests/stream", {
		body: JSON.stringify(body),
		credentials: "same-origin",
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			"idempotency-key": input.idempotencyKey ?? createIdempotencyKey(),
		},
		method: "POST",
		...(input.signal ? { signal: input.signal } : {}),
	});

	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw await createChatStreamRequestError(response);
	}
	for await (const event of readProductSse(response, "Lifecycle stream response body is empty.")) {
		yield event;
	}
}

export async function* resumeRunEventsStream(input: {
	afterSequence?: number;
	requestId: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRequestStreamEvent> {
	const params = new URLSearchParams();
	if (input.afterSequence !== undefined) {
		params.set("after_sequence", String(input.afterSequence));
	}
	const suffix = params.size > 0 ? `?${params.toString()}` : "";
	const response = await fetch(
		`/api/chat/requests/${encodeURIComponent(input.requestId)}/events/stream${suffix}`,
		{
			credentials: "same-origin",
			headers: {
				accept: "text/event-stream",
			},
			method: "GET",
			...(input.signal ? { signal: input.signal } : {}),
		},
	);

	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw await createChatStreamRequestError(response);
	}
	for await (const event of readProductSse(response, "Run event stream response body is empty.")) {
		yield event;
	}
}
