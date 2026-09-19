import { z } from "zod";
import { ChatStreamRequestError, invalidProductStreamEvent } from "./chat-stream-errors";
import type { ChatRequestStreamEvent, ChatRequestStreamEventName } from "./model";

const nonEmptyString = z.string().min(1);
const sequence = z.number().int().nonnegative();
const streamBase = z
	.object({
		occurredAt: nonEmptyString,
		requestId: nonEmptyString,
		status: nonEmptyString,
	})
	.passthrough();
const answerPayload = z
	.object({
		conversation: z.object({ id: nonEmptyString }).passthrough(),
		result: z
			.object({
				kind: z.enum(["answer", "error"]),
				requestId: nonEmptyString,
			})
			.passthrough(),
	})
	.passthrough();
const acceptedEventData = streamBase;
const queuedEventData = streamBase.extend({ sequence: sequence.optional() });
const runningEventData = streamBase.extend({ sequence: sequence.optional() });
const retrievalEventData = streamBase.extend({
	source: z.enum(["campus"]),
	status: z.enum(["started", "completed", "no_match", "failed", "canceled"]),
	sequence,
});
const phaseEventData = streamBase.extend({
	phase: z.enum(["finalizing", "generating", "preparing"]),
	sequence,
});
const deltaEventData = streamBase.extend({
	delta: z.string().min(1),
	messageId: nonEmptyString,
	sequence,
});
const completedEventData = streamBase.extend({
	answer: answerPayload.optional(),
	sequence: sequence.optional(),
});
const failedEventData = streamBase.extend({
	error: z
		.object({ code: nonEmptyString, message: nonEmptyString, retryable: z.boolean() })
		.passthrough(),
	sequence: sequence.optional(),
});
const cancelledEventData = streamBase.extend({
	answer: answerPayload.optional(),
	sequence: sequence.optional(),
});

export async function* readProductSse(
	response: Response,
	emptyBodyMessage: string,
): AsyncIterable<ChatRequestStreamEvent> {
	assertEventStreamContentType(response);
	if (!response.body) {
		throw new Error(emptyBodyMessage);
	}
	for await (const event of parseProductSse(response)) {
		yield event;
	}
}

async function* parseProductSse(response: Response): AsyncIterable<ChatRequestStreamEvent> {
	const reader = response.body?.getReader();
	if (!reader) {
		return;
	}

	const decoder = new TextDecoder();
	let buffer = "";
	let completed = false;
	try {
		while (true) {
			const chunk = await reader.read().catch((error: unknown) => {
				if (error instanceof TypeError) {
					throw new ChatStreamRequestError({
						code: "chat_stream_connection_lost",
						message: "回答连接已断开。",
						retryable: true,
					});
				}
				throw error;
			});
			if (chunk.done) {
				break;
			}
			buffer += decoder.decode(chunk.value, { stream: true });
			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/);
			}
		}
		void decoder.decode();
		// SSE events are committed only by a blank line. A truncated tail is replayed on resume.
		completed = true;
	} finally {
		if (!completed) {
			await reader.cancel().catch(() => undefined);
		}
		reader.releaseLock();
	}
}

function parseSseBlock(block: string): ChatRequestStreamEvent | null {
	let eventName: string | null = null;
	const dataLines: string[] = [];
	let meaningfulLine = false;
	for (const line of block.split(/\r?\n/)) {
		if (line === "" || line.startsWith(":")) {
			continue;
		}
		if (line.startsWith("event:")) {
			meaningfulLine = true;
			eventName = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			meaningfulLine = true;
			dataLines.push(line.slice("data:".length).trimStart());
		} else {
			throw invalidProductStreamEvent();
		}
	}
	if (!meaningfulLine) {
		return null;
	}
	if (!(eventName && dataLines.length > 0 && isProductStreamEventName(eventName))) {
		throw invalidProductStreamEvent();
	}
	let data: unknown;
	try {
		data = JSON.parse(dataLines.join("\n"));
	} catch {
		throw invalidProductStreamEvent();
	}
	if (!(data && typeof data === "object" && !Array.isArray(data))) {
		throw invalidProductStreamEvent();
	}
	if (!validateProductStreamEvent(eventName, data)) {
		throw invalidProductStreamEvent();
	}
	return {
		data: data as ChatRequestStreamEvent["data"],
		event: eventName,
	};
}

function validateProductStreamEvent(eventName: ChatRequestStreamEventName, data: unknown): boolean {
	const schema =
		eventName === "retrieval.status"
			? retrievalEventData
			: eventName === "request.accepted"
				? acceptedEventData
				: eventName === "execution.queued"
					? queuedEventData
					: eventName === "execution.running"
						? runningEventData
						: eventName === "execution.phase"
							? phaseEventData
							: eventName === "answer.delta"
								? deltaEventData
								: eventName === "request.completed"
									? completedEventData
									: eventName === "request.failed"
										? failedEventData
										: cancelledEventData;
	return schema.safeParse(data).success;
}

function assertEventStreamContentType(response: Response): void {
	const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
	if (mediaType !== "text/event-stream") {
		throw new ChatStreamRequestError({
			code: "invalid_stream_content_type",
			message: "回答连接返回了无效内容类型。",
			retryable: false,
			status: response.status,
		});
	}
}

function isProductStreamEventName(value: string): value is ChatRequestStreamEventName {
	return (
		value === "answer.delta" ||
		value === "retrieval.status" ||
		value === "execution.phase" ||
		value === "execution.queued" ||
		value === "execution.running" ||
		value === "request.accepted" ||
		value === "request.cancelled" ||
		value === "request.completed" ||
		value === "request.failed"
	);
}
