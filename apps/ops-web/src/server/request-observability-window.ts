const QUERY_PADDING_MS = 5 * 60_000;
const MAX_REQUEST_QUERY_WINDOW_MS = 30 * 60_000;

export class InvalidRequestObservabilityWindowError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidRequestObservabilityWindowError";
	}
}

export function resolveRequestObservabilityWindow(
	input: { completedAt: string | null; startedAt: string },
	now: Date,
) {
	const startedAt = Date.parse(input.startedAt);
	const completedAt = input.completedAt ? Date.parse(input.completedAt) : now.valueOf();
	if (
		!(Number.isFinite(startedAt) && Number.isFinite(completedAt) && Number.isFinite(now.valueOf()))
	) {
		throw new InvalidRequestObservabilityWindowError("Invalid request observability timestamps.");
	}
	const unboundedFrom = startedAt - QUERY_PADDING_MS;
	const to = Math.min(now.valueOf(), completedAt + QUERY_PADDING_MS);
	if (to < unboundedFrom) {
		throw new InvalidRequestObservabilityWindowError("Invalid request observability time range.");
	}
	const from = Math.max(unboundedFrom, to - MAX_REQUEST_QUERY_WINDOW_MS);
	return {
		clamped: from > unboundedFrom,
		from: new Date(from),
		to: new Date(to),
	};
}
