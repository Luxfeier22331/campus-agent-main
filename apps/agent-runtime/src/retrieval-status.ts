import type { AgentRunnerInput, StreamingAgentRunner } from "./agent-run-contract.ts";

export type RetrievalSource = "campus";
export type RetrievalStatus = "started" | "completed" | "no_match" | "failed" | "canceled";
export interface RetrievalObservation {
	source: RetrievalSource;
	status: RetrievalStatus;
	occurredAt: string;
}
export type RetrievalReporter = (
	source: RetrievalSource,
	id: string,
	status: RetrievalStatus,
) => void;
type RunnerEvent = StreamingAgentRunner extends (input: AgentRunnerInput) => AsyncIterable<infer T>
	? T
	: never;
type Event = RunnerEvent | { retrieval: RetrievalObservation };

// Multiplex real tool callbacks with the existing answer stream. This queue is
// scoped to one operation; persistence and reconnect belong to agent-control.
export async function* streamWithRetrieval(
	input: AgentRunnerInput,
	runner: StreamingAgentRunner,
): AsyncGenerator<Event> {
	const queue: Event[] = [];
	let wake: (() => void) | undefined;
	let done = false;
	let failure: unknown;
	let closed = false;
	const calls = new Map<string, { source: RetrievalSource; status: RetrievalStatus }>();
	const emit = (event: Event) => {
		if (!closed) {
			queue.push(event);
			wake?.();
			wake = undefined;
		}
	};
	const publish = (source: RetrievalSource, status: RetrievalStatus) =>
		emit({ retrieval: { source, status, occurredAt: new Date().toISOString() } });
	const report: RetrievalReporter = (source, id, status) => {
		const key = `${source}:${id}`;
		const previous = calls.get(key);
		if (previous && previous.status !== "started") {
			return;
		}
		if (status === "started") {
			if (previous) {
				return;
			}
			const active = [...calls.values()].some(
				(call) => call.source === source && call.status === "started",
			);
			if (!active) {
				for (const [key, call] of calls) {
					if (call.source === source) {
						calls.delete(key);
					}
				}
			}
			calls.set(key, { source, status });
			if (!active) {
				publish(source, status);
			}
			return;
		}
		if (!previous) {
			return;
		}
		calls.set(key, { source, status });
		const group = [...calls.values()].filter((call) => call.source === source);
		if (group.some((call) => call.status === "started")) {
			return;
		}
		publish(
			source,
			group.some((call) => call.status === "completed")
				? "completed"
				: group.some((call) => call.status === "failed")
					? "failed"
					: group.some((call) => call.status === "canceled")
						? "canceled"
						: "no_match",
		);
	};
	const finishActive = () => {
		for (const source of ["campus"] as const) {
			if ([...calls.values()].some((call) => call.source === source && call.status === "started")) {
				publish(source, input.signal?.aborted ? "canceled" : "failed");
				for (const call of calls.values()) {
					if (call.source === source && call.status === "started") {
						call.status = "failed";
					}
				}
			}
		}
	};
	const pumping = (async () => {
		try {
			for await (const item of runner({ ...input, reportRetrieval: report })) {
				if ("finalOutput" in item) {
					finishActive();
				}
				emit(item);
				if ("finalOutput" in item) {
					break;
				}
			}
		} catch (error) {
			failure = error;
		} finally {
			finishActive();
			done = true;
			wake?.();
		}
	})();
	try {
		while (!done || queue.length > 0) {
			const event = queue.shift();
			if (event) {
				yield event;
			} else {
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
			}
		}
		await pumping;
		if (failure) {
			throw failure;
		}
	} finally {
		closed = true;
	}
}
