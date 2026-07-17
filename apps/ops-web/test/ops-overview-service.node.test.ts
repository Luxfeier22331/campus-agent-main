// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsOverviewService } from "../src/server/ops-overview-service";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

describe("ops overview service", () => {
	it("combines status data and runtime signals", async () => {
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: {
				getSnapshot: vi.fn().mockResolvedValue({
					services: opsOverviewFixture.services,
					telemetry: opsOverviewFixture.telemetry,
				}),
			},
			store: {
				getOverview: vi.fn().mockResolvedValue({
					externalLinks: opsOverviewFixture.externalLinks,
					requests: opsOverviewFixture.requests,
					temporal: opsOverviewFixture.temporal,
					trends: opsOverviewFixture.trends,
				}),
			},
		});

		const overview = await service.getOverview("1h");

		expect(overview).toMatchObject({
			cache: { ageMs: 0, status: "FRESH" },
			health: { status: "DEGRADED" },
			window: "1h",
		});
		expect(overview.issues).toContainEqual(
			expect.objectContaining({
				code: "SERVICE_EXECUTION_CONTROL_DEGRADED",
				title: "执行控制状态异常",
			}),
		);
	});

	it("reuses a fresh overview for fifteen seconds", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi.fn().mockResolvedValue({
			externalLinks: opsOverviewFixture.externalLinks,
			requests: opsOverviewFixture.requests,
			temporal: opsOverviewFixture.temporal,
			trends: opsOverviewFixture.trends,
		});
		const service = createOpsOverviewService({
			now: () => current,
			signals: {
				getSnapshot: vi.fn().mockResolvedValue({
					services: opsOverviewFixture.services,
					telemetry: opsOverviewFixture.telemetry,
				}),
			},
			store: { getOverview },
		});

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:10.000Z");
		const cached = await service.getOverview("1h");

		expect(getOverview).toHaveBeenCalledOnce();
		expect(cached.cache).toEqual({ ageMs: 10_000, status: "FRESH" });
	});

	it("serves the last complete result for at most five minutes", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi
			.fn()
			.mockResolvedValueOnce({
				externalLinks: opsOverviewFixture.externalLinks,
				requests: opsOverviewFixture.requests,
				temporal: opsOverviewFixture.temporal,
				trends: opsOverviewFixture.trends,
			})
			.mockRejectedValueOnce(new Error("postgres unavailable"));
		const getSnapshot = vi
			.fn()
			.mockResolvedValueOnce({
				services: opsOverviewFixture.services,
				telemetry: opsOverviewFixture.telemetry,
			})
			.mockRejectedValueOnce(new Error("Axiom unavailable"));
		const service = createOpsOverviewService({
			now: () => current,
			signals: { getSnapshot },
			store: { getOverview },
		});

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:20.000Z");
		const stale = await service.getOverview("1h");

		expect(stale.cache).toEqual({ ageMs: 20_000, status: "STALE" });
		expect(stale.health.dataState).toBe("STALE");
	});

	it("does not replace the last complete result with a partial refresh", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi
			.fn()
			.mockResolvedValueOnce({
				externalLinks: opsOverviewFixture.externalLinks,
				requests: opsOverviewFixture.requests,
				temporal: opsOverviewFixture.temporal,
				trends: opsOverviewFixture.trends,
			})
			.mockResolvedValueOnce({
				externalLinks: opsOverviewFixture.externalLinks,
				requests: { ...opsOverviewFixture.requests, total: 200 },
				temporal: opsOverviewFixture.temporal,
				trends: opsOverviewFixture.trends,
			})
			.mockRejectedValueOnce(new Error("postgres unavailable"));
		const getSnapshot = vi
			.fn()
			.mockResolvedValueOnce({
				services: opsOverviewFixture.services,
				telemetry: opsOverviewFixture.telemetry,
			})
			.mockRejectedValueOnce(new Error("Axiom unavailable"))
			.mockRejectedValueOnce(new Error("Axiom unavailable"));
		const service = createOpsOverviewService({
			now: () => current,
			signals: { getSnapshot },
			store: { getOverview },
		});

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:20.000Z");
		const partial = await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:40.000Z");
		const stale = await service.getOverview("1h");

		expect(partial.requests.total).toBe(200);
		expect(partial.services.every((item) => item.dataState === "UNAVAILABLE")).toBe(true);
		expect(stale.cache).toEqual({ ageMs: 40_000, status: "STALE" });
		expect(stale.requests.total).toBe(opsOverviewFixture.requests.total);
		expect(stale.services).toEqual(opsOverviewFixture.services);
	});

	it("returns explicit unavailable sections when no cache exists", async () => {
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: { getSnapshot: vi.fn().mockRejectedValue(new Error("signals unavailable")) },
			store: { getOverview: vi.fn().mockRejectedValue(new Error("status unavailable")) },
		});

		const overview = await service.getOverview("15m");

		expect(overview.health).toMatchObject({ dataState: "UNAVAILABLE", status: "UNKNOWN" });
		expect(overview.requests.dataState).toBe("UNAVAILABLE");
		expect(overview.services.every((item) => item.dataState === "UNAVAILABLE")).toBe(true);
	});
});
