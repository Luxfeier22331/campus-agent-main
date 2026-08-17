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
const runStatusResponseSchema = z.object({
	run: z
		.object({
			conversationId: nonEmptyString,
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
			runId: nonEmptyString,
			status: nonEmptyString,
			terminalReason: nonEmptyString.optional(),
			traceId: nonEmptyString,
		})
		.passthrough(),
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
	conversationId: string;
	phase: ChatRunPhase;
	requestId: string;
	runId: string;
	status: string;
	terminalReason?: string;
	traceId: string;
}

export async function cancelRun(runId: string): Promise<void> {
	const response = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
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
}

export async function getRunStatus(input: {
	runId: string;
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
		const response = await fetch(`/api/chat/runs/${encodeURIComponent(input.runId)}`, {
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
		const { terminalReason, ...run } = parsed.data.run;
		return {
			...run,
			...(terminalReason === undefined ? {} : { terminalReason }),
		};
	} catch (error) {
		if (timedOut) {
			throw new ChatStreamRequestError({
				code: "run_status_timeout",
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
	runId: string;
	signal?: AbortSignal;
}): AsyncIterable<ChatRequestStreamEvent> {
	const params = new URLSearchParams();
	if (input.afterSequence !== undefined) {
		params.set("after_sequence", String(input.afterSequence));
	}
	const suffix = params.size > 0 ? `?${params.toString()}` : "";
	const response = await fetch(
		`/api/chat/runs/${encodeURIComponent(input.runId)}/events/stream${suffix}`,
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
