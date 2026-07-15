export interface StoppableCrawler<Request> {
	run(requests: Request[]): Promise<unknown>;
	stop?(reason?: string): Promise<void> | void;
}

export async function runCrawleeWithCancellation<Request>(input: {
	abortSignal?: AbortSignal;
	crawler: StoppableCrawler<Request>;
	requests: Request[];
}): Promise<void> {
	const signal = input.abortSignal;
	if (!signal) {
		await input.crawler.run(input.requests);
		return;
	}

	signal.throwIfAborted();
	let stopPromise: Promise<void> | undefined;
	const stop = () => {
		if (!(stopPromise || !input.crawler.stop)) {
			stopPromise = Promise.resolve(input.crawler.stop("Temporal Activity cancellation requested"));
		}
	};
	signal.addEventListener("abort", stop, { once: true });
	let runError: unknown;
	let runFailed = false;
	try {
		await input.crawler.run(input.requests);
	} catch (error) {
		runError = error;
		runFailed = true;
	}
	signal.removeEventListener("abort", stop);
	let stopError: unknown;
	let stopFailed = false;
	if (stopPromise) {
		try {
			await stopPromise;
		} catch (error) {
			stopError = error;
			stopFailed = true;
		}
	}
	signal.throwIfAborted();
	if (runFailed) {
		throw runError;
	}
	if (stopFailed) {
		throw stopError;
	}
}
