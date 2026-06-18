import { afterEach, describe, expect, it, vi } from "vitest";

import { getOperatorOverview, getOperatorRuntimeHealth } from "../src/panel/data-provider/operator";
import { getRequestList } from "../src/panel/data-provider/requests";
import { mockJsonFetch } from "./data-provider.test-support";

describe("Operator Console minimal data clients", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps request list filters onto the protected same-site request projection", async () => {
		const fetchSpy = mockJsonFetch({
			page: { nextCursor: null },
			requests: [
				{
					answerPreview: "图书馆开放到 22:00。",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					durationMs: 812,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "图书馆开放到几点？",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					requestedScope: null,
					selectedCapability: "knowledge",
					sourceDocIds: [],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
			],
		});

		const response = await getRequestList({
			filter: { q: "图书馆", status: "completed" },
			pagination: { page: 1, perPage: 20 },
		});

		expect(response.data[0]).toMatchObject({
			id: "req_01HQ",
			requestId: "req_01HQ",
			status: "completed",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests?limit=20&q=%E5%9B%BE%E4%B9%A6%E9%A6%86&status=completed",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("loads operator overview and runtime health without quality/eval governance clients", async () => {
		const fetchSpy = mockJsonFetch(
			{
				alerts: [],
				asOf: "2026-06-16T08:00:00.000Z",
				overview: {
					aclAnomalyRate: { count: 0, eligibleCount: 1, value: 0 },
					citationMissRate: { count: 0, eligibleCount: 1, value: 0 },
					emptyRecallRate: { count: 0, eligibleCount: 1, value: 0 },
					estimatedCost: { currency: "USD", microusd: 0 },
					failureRate: { count: 0, eligibleCount: 1, value: 0 },
					latency: { p50Ms: 100, p95Ms: 200, p99Ms: 300 },
					refusalRate: { count: 0, eligibleCount: 1, value: 0 },
					requestVolume: { accepted: 1, completed: 1, errored: 0 },
					sinkHealth: {
						missingTraceRate: { count: 0, eligibleCount: 1, value: 0 },
						projectionFailureCount: 0,
					},
				},
				window: {
					from: "2026-06-15T08:00:00.000Z",
					granularity: "1h",
					to: "2026-06-16T08:00:00.000Z",
				},
			},
			{
				asOf: "2026-06-16T08:00:00.000Z",
				executionRuntime: {
					blockers: {},
					checks: { runProjectionStore: "ready", temporalRuntime: "ready" },
					status: "ready",
				},
				runProjectionStore: null,
				status: "ready",
				temporalRuntime: null,
			},
		);

		await expect(getOperatorOverview({ window: "24h" })).resolves.toMatchObject({
			data: { overview: { requestVolume: { completed: 1 } } },
		});
		await expect(getOperatorRuntimeHealth()).resolves.toMatchObject({
			data: { executionRuntime: { status: "ready" } },
		});
		expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
			"/api/operator/overview?window=24h",
			"/api/operator/runtime/health",
		]);
	});
});
