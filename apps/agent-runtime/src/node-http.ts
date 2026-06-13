import type { IncomingMessage, ServerResponse } from "node:http";

interface AbortEventSource {
	once(eventName: string, listener: () => void): unknown;
}

export function nodeClientDisconnectSignal(
	request: IncomingMessage | AbortEventSource,
	response: ServerResponse | AbortEventSource,
): AbortSignal {
	const controller = new AbortController();
	const abort = () => {
		if (!controller.signal.aborted) {
			controller.abort();
		}
	};
	request.once("aborted", abort);
	response.once("close", abort);
	return controller.signal;
}
