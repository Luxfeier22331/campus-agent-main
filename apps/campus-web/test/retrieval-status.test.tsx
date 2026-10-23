import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RetrievalStatus } from "../src/components/conversation/retrieval-status";
import { reduceRuntimeRunState } from "../src/features/conversation/conversation-run-state";
import { EMPTY_RUNTIME_RUN } from "../src/features/conversation/conversation-run-types";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";

const event = (sequence: number, source: "campus", status: string): ChatRequestStreamEvent => ({
	event: "retrieval.status",
	data: { requestId: "req", occurredAt: "2026-09-18T00:00:00Z", source, status, sequence },
});
it("replays source states, ignores duplicates and cannot reopen a terminal request", () => {
	let state = { ...EMPTY_RUNTIME_RUN, operationId: 1 };
	const apply = (value: ChatRequestStreamEvent) => {
		state = reduceRuntimeRunState(state, { type: "event", operationId: 1, event: value });
	};
	apply(event(1, "campus", "started"));
	apply(event(3, "campus", "no_match"));
	apply(event(2, "campus", "started"));
	expect(state.retrieval).toEqual({ campus: "no_match" });
	apply({
		event: "request.completed",
		data: {
			requestId: "req",
			occurredAt: "2026-09-18T00:00:01Z",
			status: "completed",
			sequence: 4,
		},
	});
	apply(event(5, "campus", "started"));
	expect(state.retrieval).toEqual({});
});
describe("retrieval labels", () => {
	it("renders campus status", () => {
		render(<RetrievalStatus statuses={{ campus: "completed" }} />);
		expect(screen.getByText("已找到校内资料")).toBeVisible();
	});
	it("has no search status without an actual event", () => {
		const { container } = render(<RetrievalStatus />);
		expect(container).toBeEmptyDOMElement();
	});
});
