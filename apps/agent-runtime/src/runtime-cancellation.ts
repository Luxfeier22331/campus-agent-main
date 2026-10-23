// The response deadline belongs to this service, not to SDK cleanup. Aborting
// still reaches the work, but waiting for that work must be independently bounded.
export function waitForRuntimeWork<T>(signal: AbortSignal, work: () => PromiseLike<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		const onAbort = () => {
			cleanup();
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			// Both handlers remain attached after cancellation to consume late failures.
			Promise.resolve(work()).then(
				(value) => {
					cleanup();
					resolve(value);
				},
				(error: unknown) => {
					cleanup();
					reject(error);
				},
			);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}

export function createRuntimeCancellation(parent: AbortSignal, deadlineMs: number) {
	const deadline = new AbortController();
	const cancellation = new AbortController();
	const timer = setTimeout(
		() => deadline.abort(new DOMException("Operation deadline exceeded", "TimeoutError")),
		deadlineMs,
	);
	timer.unref();
	const stopTimer = () => clearTimeout(timer);
	if (parent.aborted) {
		stopTimer();
	} else {
		parent.addEventListener("abort", stopTimer, { once: true });
	}
	const dispose = () => {
		stopTimer();
		parent.removeEventListener("abort", stopTimer);
	};
	return {
		deadlineSignal: deadline.signal,
		signal: AbortSignal.any([parent, deadline.signal, cancellation.signal]),
		dispose,
		cancel() {
			dispose();
			cancellation.abort();
		},
	};
}
