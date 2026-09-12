import type { Model, ModelRequest } from "@openai/agents";

// Deliberately ignores cancellation until cleanup is released. Used with the
// real SDK and HTTP server; no production fault-injection switches are needed.
export function delayedCancellationModel(options: {
	afterAbort: () => Promise<void>;
	onStart?: () => void;
	onAbort?: () => void;
}): Model {
	async function wait(request: ModelRequest): Promise<never> {
		const signal = request.signal;
		if (!signal) {
			throw new Error("The controlled model requires a cancellation signal.");
		}
		options.onStart?.();
		await new Promise<void>((resolve) => {
			if (signal.aborted) {
				resolve();
			} else {
				signal.addEventListener("abort", () => resolve(), { once: true });
			}
		});
		options.onAbort?.();
		await options.afterAbort();
		throw signal.reason;
	}
	return {
		getResponse: wait,
		async *getStreamedResponse(request) {
			yield await wait(request);
		},
	};
}
