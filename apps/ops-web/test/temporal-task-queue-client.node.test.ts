// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createTemporalTaskQueueSource } from "../src/server/temporal-task-queue-client";

describe("Temporal task queue client", () => {
	it("reads execution-control once during the 15 second cache window", async () => {
		let now = new Date("2026-07-12T12:00:00Z");
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				queues: [
					{
						backlogCount: 2,
						name: "campus-agent.workflow.v3",
						oldestTaskAgeSeconds: 1.25,
						pollerCount: 1,
						type: "workflow",
					},
				],
				sampledAt: "2026-07-12T12:00:00Z",
			}),
		);
		const source = createTemporalTaskQueueSource({
			baseUrl: "http://execution-control:8000/",
			bearerToken: "metrics-token",
			fetchFn,
			now: () => now,
		});

		const first = await source.getTaskQueues();
		now = new Date("2026-07-12T12:00:10Z");
		const second = await source.getTaskQueues();

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledWith(
			"http://execution-control:8000/internal/ops/temporal/task-queues",
			expect.objectContaining({ headers: { authorization: "Bearer metrics-token" } }),
		);
		expect(first).toEqual(second);
		expect(first.state).toBe("FRESH");
		expect(first.rows[0]).toMatchObject({
			backlogJson: { count: 2, state: "observed" },
			oldestTaskAgeJson: { ms: 1250, state: "observed" },
			pollerCount: 1,
			taskQueue: "campus-agent.workflow.v3",
		});
	});

	it("returns an explicit unavailable result when the first live query fails", async () => {
		const source = createTemporalTaskQueueSource({
			baseUrl: "http://execution-control:8000",
			bearerToken: "metrics-token",
			fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
		});

		expect(await source.getTaskQueues()).toEqual({
			reason: "Temporal 队列查询不可用。",
			rows: [],
			state: "UNAVAILABLE",
		});
	});

	it("distinguishes missing configuration from an empty live response", async () => {
		const source = createTemporalTaskQueueSource({ baseUrl: "", bearerToken: "" });

		expect(await source.getTaskQueues()).toEqual({
			reason: "Temporal 队列查询未配置。",
			rows: [],
			state: "NOT_CONFIGURED",
		});
	});
});
