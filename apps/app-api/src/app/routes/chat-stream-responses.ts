import type { ChatCommandStreamEvent } from "../../modules/runtime-command";

function encodeSseEvent(event: ChatCommandStreamEvent): Uint8Array {
	return new TextEncoder().encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function encodeSseComment(comment: string): Uint8Array {
	return new TextEncoder().encode(`: ${comment}\n\n`);
}

export function createChatSseResponse(input: {
	first: ChatCommandStreamEvent;
	iterator: AsyncIterator<ChatCommandStreamEvent>;
}): Response {
	const stream = new ReadableStream<Uint8Array>({
		async cancel() {
			await input.iterator.return?.();
		},
		async start(controller) {
			let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
			async function emit(event: ChatCommandStreamEvent) {
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
