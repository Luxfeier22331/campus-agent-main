// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsOverviewService } from "../src/server/ops-overview-service";
import type { OpsStatusOverview } from "../src/server/ops-status-store";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

function statusOverview(requestTotal = opsOverviewFixture.requests.total): OpsStatusOverview {
	return {
		externalLinks: opsOverviewFixture.externalLinks,
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

		const overview = await service.getOverview("1h");

		expect(overview).toMatchObject({
			cache: { ageMs: 0, status: "FRESH" },
			health: { dataState: "FRESH", status: "DEGRADED" },
			window: "1h",
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

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:10.000Z");
		const cached = await service.getOverview("1h");

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

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:20.000Z");
		const stale = await service.getOverview("1h");

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

		const overview = await service.getOverview("15m");

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

		const overview = await service.getOverview("1h");

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

		const overview = await service.getOverview("15m");

		expect(overview.requests.dataState).toBe("UNAVAILABLE");
	});

	it("shares concurrent database reads", async () => {
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const service = createOpsOverviewService({ store: { getOverview } });

		await Promise.all([service.getOverview("1h"), service.getOverview("1h")]);

		expect(getOverview).toHaveBeenCalledOnce();
	});
});
