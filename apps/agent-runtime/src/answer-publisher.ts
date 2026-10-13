import type { AnswerDeltaRequest } from "campus-contracts/agent-runtime-control";
import { type AgentControlClient, ControlHTTPError } from "./control-client.ts";

// A model call can lose its draft without losing its canonical result.
export function createAnswerPublisher(input: {
	control: AgentControlClient;
	signal: AbortSignal;
	onUnavailable: () => void;
}) {
	let stopped = false;
	return async (delta: Omit<AnswerDeltaRequest, "activity">): Promise<void> => {
		input.signal.throwIfAborted();
		if (stopped) {
			return;
		}
		const timeout = AbortSignal.timeout(1000);
		try {
			await input.control.call("answer/delta", delta, AbortSignal.any([input.signal, timeout]));
		} catch (error) {
			input.signal.throwIfAborted();
			const unavailable =
				error instanceof ControlHTTPError
					? error.retryable && (error.status >= 500 || error.status === 408 || error.status === 429)
					: error instanceof TypeError || (timeout.aborted && error instanceof DOMException);
			if (!unavailable) {
				throw error;
			}
			stopped = true;
			input.onUnavailable();
		}
	};
}
