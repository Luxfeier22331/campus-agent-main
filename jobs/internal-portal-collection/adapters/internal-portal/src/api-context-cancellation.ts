import type { DisposableApiContextLike } from "./types.js";

export function bindApiContextCancellation(
	apiContext: DisposableApiContextLike,
	abortSignal?: AbortSignal,
): () => Promise<void> {
	let disposePromise: Promise<void> | undefined;
	const dispose = () => {
		disposePromise ??= apiContext.dispose();
		return disposePromise;
	};
	const abort = () => {
		void dispose().catch(() => undefined);
	};
	abortSignal?.addEventListener("abort", abort, { once: true });

	return async () => {
		abortSignal?.removeEventListener("abort", abort);
		try {
			await dispose();
		} catch (error) {
			abortSignal?.throwIfAborted();
			throw error;
		}
	};
}
