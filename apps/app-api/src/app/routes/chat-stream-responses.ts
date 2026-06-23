import { AppApiRouteError } from "../../http";
import type { ChatCommandStreamEvent } from "../../modules/runtime-command";

function encodeSseEvent(event: ChatCommandStreamEvent): Uint8Array {
	return new TextEncoder().encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function encodeSseComment(comment: string): Uint8Array {
	return new TextEncoder().encode(`: ${comment}\n\n`);
}

function encodeAssistantUiDataStreamChunk(type: string, value: unknown): Uint8Array {
	return new TextEncoder().encode(`${type}:${JSON.stringify(value)}\n`);
}

function isTerminalChatStreamEvent(event: ChatCommandStreamEvent): boolean {
	return (
		event.event === "request.completed" ||
		event.event === "request.failed" ||
		event.event === "request.cancelled"
	);
}

export function createChatSseResponse(input: {
	first: ChatCommandStreamEvent;
	iterator: AsyncIterator<ChatCommandStreamEvent>;
	onTerminal?: (event: ChatCommandStreamEvent) => void;
}): Response {
	const stream = new ReadableStream<Uint8Array>({
		async cancel() {
			await input.iterator.return?.();
		},
		async start(controller) {
			let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
			async function emit(event: ChatCommandStreamEvent) {
				if (isTerminalChatStreamEvent(event)) {
					input.onTerminal?.(event);
				}
				controller.enqueue(encodeSseEvent(event));
			}

			try {
				controller.enqueue(encodeSseComment("keepalive"));
				keepaliveInterval = setInterval(() => {
					controller.enqueue(encodeSseComment("keepalive"));
				}, 15_000);
				await emit(input.first);
				while (true) {
					const next = await input.iterator.next();
					if (next.done) {
						break;
					}
					await emit(next.value);
				}
			} finally {
				if (keepaliveInterval) {
					clearInterval(keepaliveInterval);
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
			"x-request-id": input.first.data.requestId,
			"x-trace-id": input.first.data.traceId,
		},
		status: 200,
	});
}

export function readAssistantUiPrompt(body: Record<string, unknown>): {
	conversationId?: string;
	prompt: string;
} {
	const messages = body.messages;
	if (!Array.isArray(messages)) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "messages is required.",
			retryable: false,
			status: 400,
		});
	}

	const lastUserMessage = messages
		.slice()
		.reverse()
		.find(
			(message): message is Record<string, unknown> =>
				Boolean(message) &&
				typeof message === "object" &&
				!Array.isArray(message) &&
				(message as Record<string, unknown>).role === "user",
		);
	const prompt = lastUserMessage ? readAssistantUiTextContent(lastUserMessage.content) : "";
	if (!prompt.trim()) {
		throw new AppApiRouteError({
			code: "invalid_request",
			message: "Last user message text is required.",
			retryable: false,
			status: 400,
		});
	}

	const threadId = body.threadId;
	return {
		conversationId: typeof threadId === "string" && threadId.trim() ? threadId : undefined,
		prompt: prompt.trim(),
	};
}

function readAssistantUiTextContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((part) => {
			if (!part || typeof part !== "object" || Array.isArray(part)) {
				return "";
			}
			const record = part as Record<string, unknown>;
			return record.type === "text" && typeof record.text === "string" ? record.text : "";
		})
		.join("");
}

export function createAssistantUiDataStreamResponse(input: {
	first: ChatCommandStreamEvent;
	iterator: AsyncIterator<ChatCommandStreamEvent>;
	onTerminal?: (event: ChatCommandStreamEvent) => void;
}): Response {
	const stream = new ReadableStream<Uint8Array>({
		async cancel() {
			await input.iterator.return?.();
		},
		async start(controller) {
			async function emitTerminal(event: ChatCommandStreamEvent) {
				input.onTerminal?.(event);
				if (event.event === "request.completed" && event.data.answer) {
					const result = event.data.answer.result;
					if (result.kind === "error") {
						controller.enqueue(
							encodeAssistantUiDataStreamChunk("3", {
								message: result.message,
							}),
						);
						return;
					}
					controller.enqueue(encodeAssistantUiDataStreamChunk("0", result.text));
					for (const message of event.data.answer.conversation.messages ?? []) {
						if (message.role !== "assistant") {
							continue;
						}
						for (const part of message.structuredParts ?? []) {
							controller.enqueue(
								encodeAssistantUiDataStreamChunk("aui-data", {
									data: part,
									name: part.type,
								}),
							);
						}
					}
					controller.enqueue(
						encodeAssistantUiDataStreamChunk("d", {
							finishReason: "stop",
							usage: {
								completionTokens: 0,
								promptTokens: 0,
							},
						}),
					);
					return;
				}

				const error = event.data.error;
				controller.enqueue(
					encodeAssistantUiDataStreamChunk("3", {
						message:
							error?.message ??
							(event.event === "request.cancelled" ? "回答已取消。" : "回答失败。"),
					}),
				);
			}

			try {
				if (isTerminalChatStreamEvent(input.first)) {
					await emitTerminal(input.first);
					return;
				}
				while (true) {
					const next = await input.iterator.next();
					if (next.done) {
						break;
					}
					if (isTerminalChatStreamEvent(next.value)) {
						await emitTerminal(next.value);
						break;
					}
				}
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"cache-control": "no-store",
			"content-type": "text/plain; charset=utf-8",
			"x-accel-buffering": "no",
			"x-request-id": input.first.data.requestId,
			"x-trace-id": input.first.data.traceId,
			"x-vercel-ai-data-stream": "v1",
		},
		status: 200,
	});
}
