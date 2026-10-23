// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsOverviewService } from "../src/server/ops-status/composition/overview-service.ts";
import type { OpsStatusOverview } from "../src/server/ops-status/contract.ts";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

function statusOverview(requestTotal = opsOverviewFixture.requests.total): OpsStatusOverview {
	return {
		requests: { ...opsOverviewFixture.requests, total: requestTotal },
		trends: opsOverviewFixture.trends,
	};
}

describe("ops overview service", () => {
	it("derives health and issues only from product request facts", async () => {
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			store: { getOverview: vi.fn().mockResolvedValue(statusOverview()) },
		});

		const overview = await service.getOverview({ window: "today" });

		expect(overview).toMatchObject({
			cache: { ageMs: 0, status: "FRESH" },
			health: { dataState: "FRESH", status: "DEGRADED" },
			window: "today",
		});
		expect(overview.issues).toEqual([
			expect.objectContaining({ code: "REQUESTS_DEGRADED", source: "REQUESTS" }),
		]);
		expect(overview).not.toHaveProperty("services");
		expect(overview).not.toHaveProperty("temporal");
		expect(overview).not.toHaveProperty("telemetry");
	});

	it("reuses a fresh overview for fifteen seconds", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const service = createOpsOverviewService({
			now: () => current,
			store: { getOverview },
		});

		await service.getOverview({ window: "today" });
		current = new Date("2026-07-09T06:30:10.000Z");
		const cached = await service.getOverview({ window: "today" });

		expect(getOverview).toHaveBeenCalledOnce();
		expect(cached.cache).toEqual({ ageMs: 10_000, status: "FRESH" });
	});

	it("marks cached request facts stale when the database refresh fails", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi
			.fn()
			.mockResolvedValueOnce(statusOverview())
			.mockRejectedValueOnce(new Error("status unavailable"));
		const service = createOpsOverviewService({
			now: () => current,
			store: { getOverview },
		});

		await service.getOverview({ window: "today" });
		current = new Date("2026-07-09T06:30:20.000Z");
		const stale = await service.getOverview({ window: "today" });

		expect(stale.cache).toEqual({ ageMs: 20_000, status: "STALE" });
		expect(stale.requests.dataState).toBe("STALE");
		expect(stale.trends).toMatchObject({
			dataState: "STALE",
			reason: "请求趋势刷新失败，显示旧数据。",
		});
	});

	it("returns explicit unavailable product sections when no cache exists", async () => {
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			store: { getOverview: vi.fn().mockRejectedValue(new Error("status unavailable")) },
		});

		const overview = await service.getOverview({ window: "last-month" });

		expect(overview.health).toEqual({ dataState: "UNAVAILABLE", status: "UNKNOWN" });
		expect(overview.requests.dataState).toBe("UNAVAILABLE");
		expect(overview.trends.dataState).toBe("UNAVAILABLE");
		expect(overview.issues.map((issue) => issue.code)).toEqual([
			"REQUESTS_UNAVAILABLE",
			"REQUEST_TRENDS_UNAVAILABLE",
		]);
	});

	it("reports a missing trend projection without changing request health", async () => {
		const status = statusOverview();
		status.requests = { ...status.requests, failed: 0, reason: null, status: "HEALTHY" };
		status.trends = { data: [], dataState: "UNAVAILABLE", reason: "请求趋势查询不可用。" };
		const service = createOpsOverviewService({
			store: { getOverview: vi.fn().mockResolvedValue(status) },
		});

		const overview = await service.getOverview({ window: "today" });

		expect(overview.health).toEqual({ dataState: "PARTIAL", status: "HEALTHY" });
		expect(overview.issues).toContainEqual(
			expect.objectContaining({ code: "REQUEST_TRENDS_UNAVAILABLE", source: "REQUESTS" }),
		);
	});

	it("bounds a stalled database overview read", async () => {
		const service = createOpsOverviewService({
			store: { getOverview: vi.fn(() => new Promise<never>(() => undefined)) },
			timeoutMs: 5,
		});

		const overview = await service.getOverview({ window: "last-month" });

		expect(overview.requests.dataState).toBe("UNAVAILABLE");
	});

	it("shares concurrent database reads", async () => {
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const service = createOpsOverviewService({ store: { getOverview } });

		await Promise.all([
			service.getOverview({ window: "today" }),
			service.getOverview({ window: "today" }),
		]);

		expect(getOverview).toHaveBeenCalledOnce();
	});
});

describe("overview interval cache", () => {
	it("preserves the exact rolling interval when fresh and when falling back", async () => {
		let current = new Date("2026-09-17T04:00:00Z");
		const getOverview = vi
			.fn()
			.mockResolvedValueOnce(statusOverview())
			.mockRejectedValue(new Error("offline"));
		const service = createOpsOverviewService({ now: () => current, store: { getOverview } });
		const original = await service.getOverview({ window: "24h" });
		current = new Date("2026-09-17T04:00:10Z");
		expect((await service.getOverview({ window: "24h" })).filters).toEqual(original.filters);
		expect(getOverview).toHaveBeenCalledTimes(1);
		current = new Date("2026-09-17T04:00:20Z");
		const stale = await service.getOverview({ window: "24h" });
		expect(stale.cache.status).toBe("STALE");
		expect(stale.filters).toEqual(original.filters);
		expect(stale.generatedAt).toBe(original.generatedAt);
	});
	it("does not reuse yesterday's today cache after Beijing midnight", async () => {
		let current = new Date("2026-09-17T15:59:58Z");
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const service = createOpsOverviewService({ now: () => current, store: { getOverview } });
		await service.getOverview({ window: "today" });
		current = new Date("2026-09-17T16:00:02Z");
		const next = await service.getOverview({ window: "today" });
		expect(next.filters.from).toBe("2026-09-17T16:00:00.000Z");
		expect(getOverview).toHaveBeenCalledTimes(2);
	});
	it("isolates custom intervals and bounds cached intervals to 64 entries", async () => {
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const service = createOpsOverviewService({
			now: () => new Date("2026-09-17T04:00:00Z"),
			store: { getOverview },
		});
		const ranges = Array.from({ length: 65 }, (_, index) => ({
			from: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
			to: new Date(Date.UTC(2026, 0, index + 2)).toISOString(),
		}));
		for (const range of ranges) {
			expect((await service.getOverview(range)).filters).toEqual(range);
		}
		const first = ranges[0];
		const last = ranges.at(-1);
		if (!(first && last)) {
			throw new Error("missing cache fixtures");
		}
		await service.getOverview(last);
		expect(getOverview).toHaveBeenCalledTimes(65);
		await service.getOverview(first);
		expect(getOverview).toHaveBeenCalledTimes(66);
	});
});
