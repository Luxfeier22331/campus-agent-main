// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createOpsOverviewService,
	type OpsRuntimeSignalsSource,
} from "../src/server/ops-overview-service";
import type { OpsStatusOverview } from "../src/server/ops-status-store";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

function statusOverview(requestTotal = opsOverviewFixture.requests.total): OpsStatusOverview {
	return {
		externalLinks: opsOverviewFixture.externalLinks,
		requests: { ...opsOverviewFixture.requests, total: requestTotal },
		temporal: opsOverviewFixture.temporal,
		trends: opsOverviewFixture.trends,
	};
}

function signals(overrides: Partial<OpsRuntimeSignalsSource> = {}): OpsRuntimeSignalsSource {
	return {
		getServices: vi.fn().mockResolvedValue(opsOverviewFixture.services),
		getTelemetry: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
		...overrides,
	};
}

describe("ops overview service", () => {
	it("combines product status while keeping observability out of product health", async () => {
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: signals(),
			store: { getOverview: vi.fn().mockResolvedValue(statusOverview()) },
		});

		const overview = await service.getOverview("1h");

		expect(overview).toMatchObject({
			cache: { ageMs: 0, status: "FRESH" },
			health: { status: "DEGRADED" },
			window: "1h",
		});
		expect(overview.issues).toContainEqual(
			expect.objectContaining({ code: "SERVICE_EXECUTION_CONTROL_DEGRADED" }),
		);
		const telemetryUnavailable = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: signals({ getTelemetry: vi.fn().mockRejectedValue(new Error("Axiom failed")) }),
			store: { getOverview: vi.fn().mockResolvedValue(statusOverview()) },
		});
		const withoutTelemetry = await telemetryUnavailable.getOverview("1h");
		expect(withoutTelemetry.health.status).toBe("DEGRADED");
		expect(withoutTelemetry.issues.every((issue) => issue.source !== "TELEMETRY")).toBe(true);
	});

	it("reuses a fresh overview for fifteen seconds", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const service = createOpsOverviewService({
			now: () => current,
			signals: signals(),
			store: { getOverview },
		});

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:10.000Z");
		const cached = await service.getOverview("1h");

		expect(getOverview).toHaveBeenCalledOnce();
		expect(cached.cache).toEqual({ ageMs: 10_000, status: "FRESH" });
	});

	it("keeps successful sources fresh when one source falls back to stale data", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi
			.fn()
			.mockResolvedValueOnce(statusOverview())
			.mockResolvedValueOnce(statusOverview(200));
		const getServices = vi
			.fn()
			.mockResolvedValueOnce(opsOverviewFixture.services)
			.mockRejectedValueOnce(new Error("probe source failed"));
		const service = createOpsOverviewService({
			now: () => current,
			signals: signals({ getServices }),
			store: { getOverview },
		});

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:20.000Z");
		const partial = await service.getOverview("1h");

		expect(partial.cache).toEqual({ ageMs: 20_000, status: "STALE" });
		expect(partial.requests).toMatchObject({ dataState: "FRESH", total: 200 });
		expect(partial.services.every((item) => item.dataState === "STALE")).toBe(true);
		expect(partial.telemetry.dataState).toBe("FRESH");
	});

	it("marks cached request trends stale when status refresh fails", async () => {
		let current = new Date("2026-07-09T06:30:00.000Z");
		const getOverview = vi
			.fn()
			.mockResolvedValueOnce(statusOverview())
			.mockRejectedValueOnce(new Error("status unavailable"));
		const service = createOpsOverviewService({
			now: () => current,
			signals: signals(),
			store: { getOverview },
		});

		await service.getOverview("1h");
		current = new Date("2026-07-09T06:30:20.000Z");
		const stale = await service.getOverview("1h");

		expect(stale.requests.dataState).toBe("STALE");
		expect(stale.trends).toMatchObject({
			dataState: "STALE",
			reason: "请求趋势刷新失败，显示旧数据。",
		});
	});

	it("returns explicit unavailable sections when no source cache exists", async () => {
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: signals({
				getServices: vi.fn().mockRejectedValue(new Error("probes unavailable")),
				getTelemetry: vi.fn().mockRejectedValue(new Error("Axiom unavailable")),
			}),
			store: { getOverview: vi.fn().mockRejectedValue(new Error("status unavailable")) },
		});

		const overview = await service.getOverview("15m");

		expect(overview.health).toMatchObject({ dataState: "UNAVAILABLE", status: "UNKNOWN" });
		expect(overview.requests.dataState).toBe("UNAVAILABLE");
		expect(overview.services).toEqual([]);
		expect(overview.telemetry.dataState).toBe("UNAVAILABLE");
	});

	it("keeps unreadable service state unknown and reports mixed data as partial", async () => {
		const healthyStatus = statusOverview();
		healthyStatus.requests = {
			...healthyStatus.requests,
			dataState: "FRESH",
			failed: 0,
			reason: null,
			status: "HEALTHY",
		};
		healthyStatus.temporal = {
			...healthyStatus.temporal,
			dataState: "FRESH",
			reason: null,
			status: "HEALTHY",
		};
		const services = opsOverviewFixture.services.map((service, index) => ({
			...service,
			dataState: index === 0 ? ("UNAVAILABLE" as const) : ("STALE" as const),
			reason: index === 0 ? "健康检查无法读取。" : "显示旧数据。",
			status: index === 0 ? ("UNKNOWN" as const) : ("HEALTHY" as const),
			updatedAt: index === 0 ? null : service.updatedAt,
		}));
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: signals({ getServices: vi.fn().mockResolvedValue(services) }),
			store: { getOverview: vi.fn().mockResolvedValue(healthyStatus) },
		});

		const overview = await service.getOverview("15m");

		expect(overview.health).toEqual({ dataState: "PARTIAL", status: "UNKNOWN" });
		expect(overview.issues).toContainEqual(
			expect.objectContaining({ code: "SERVICE_CAMPUS_WEB_UNKNOWN", severity: "WARNING" }),
		);
	});

	it("aborts only the timed out source", async () => {
		let receivedSignal: AbortSignal | undefined;
		const getServices = vi.fn(
			(input?: { signal?: AbortSignal }) =>
				new Promise<never>((_resolve, reject) => {
					receivedSignal = input?.signal;
					receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), {
						once: true,
					});
				}),
		);
		const service = createOpsOverviewService({
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			signals: signals({ getServices }),
			store: { getOverview: vi.fn().mockResolvedValue(statusOverview()) },
			timeoutMs: 5,
		});

		const overview = await service.getOverview("15m");

		expect(receivedSignal?.aborted).toBe(true);
		expect(overview.services).toEqual([]);
		expect(overview.telemetry.dataState).toBe("FRESH");
	});

	it("shares concurrent source reads", async () => {
		const getOverview = vi.fn().mockResolvedValue(statusOverview());
		const getServices = vi.fn().mockResolvedValue(opsOverviewFixture.services);
		const getTelemetry = vi.fn().mockResolvedValue(opsOverviewFixture.telemetry);
		const service = createOpsOverviewService({
			signals: { getServices, getTelemetry },
			store: { getOverview },
		});

		await Promise.all([service.getOverview("1h"), service.getOverview("1h")]);

		expect(getOverview).toHaveBeenCalledOnce();
		expect(getServices).toHaveBeenCalledOnce();
		expect(getTelemetry).toHaveBeenCalledOnce();
	});
});
