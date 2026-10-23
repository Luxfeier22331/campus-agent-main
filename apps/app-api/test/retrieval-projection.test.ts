// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lifecycleEventFromDurableRunEvent } from "../src/modules/runtime-command/service/durable";
import { toBrowserRunEvent } from "../src/modules/runtime-run/browser-projection";
import { durableEvent } from "./chat-command.service.durable-cutover.test-support";

describe("retrieval product projection", () => {
	it.each(["started", "completed", "no_match", "failed", "canceled"])(
		"projects %s consistently for SSE and replay",
		(status) => {
			const event = durableEvent({
				eventType: "run.retrieval_status",
				sequence: 5,
				payload: { source: "campus", status, query: "private", invocation_id: "internal" },
			});
			const stream = lifecycleEventFromDurableRunEvent(
				{ requestId: event.requestId, acceptedAt: event.occurredAt },
				event,
			);
			const replay = toBrowserRunEvent(event);
			expect(stream).toEqual({
				event: "retrieval.status",
				data: {
					requestId: event.requestId,
					sequence: 5,
					occurredAt: event.occurredAt,
					source: "campus",
					status,
				},
			});
			expect(replay?.payload).toEqual({ source: "campus", status });
			expect(JSON.stringify([stream, replay])).not.toContain("private");
		},
	);
	it("rejects invalid lifecycle data and does not project internal events", () => {
		const event = durableEvent({
			eventType: "run.retrieval_status",
			sequence: 5,
			payload: { source: "provider", status: "started" },
		});
		expect(() =>
			lifecycleEventFromDurableRunEvent(
				{ requestId: event.requestId, acceptedAt: event.occurredAt },
				event,
			),
		).toThrow();
		expect(toBrowserRunEvent({ ...event, visibility: "internal" })).toBeNull();
	});
});
