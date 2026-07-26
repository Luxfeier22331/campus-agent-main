// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsRuntimeSignalsSource } from "../src/server/ops-runtime-signals";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

describe("ops runtime signals", () => {
	it("checks fixed service endpoints and preserves partial failures", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			const url = String(input);
			return Response.json(
				url.includes("execution-control") ? { error: { code: "not_ready" } } : { status: "ready" },
				{ status: url.includes("execution-control") ? 503 : 200 },
			);
		});
		const getTelemetrySnapshot = vi.fn().mockResolvedValue(opsOverviewFixture.telemetry);
		const source = createOpsRuntimeSignalsSource({
			fetchFn,
			healthUrls: {
				"agent-runtime": "http://agent-runtime:27062",
				"app-api": "https://api.example.test",
				"campus-web": "https://campus.example.test",
				"execution-control": "http://execution-control:8000",
			},
			internalToken: "ops-web-token",
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			axiom: {
				getTelemetrySnapshot,
				queryRequest: vi.fn(),
			},
		});
		const controller = new AbortController();

		const services = await source.getServices({ signal: controller.signal });
		const telemetry = await source.getTelemetry("15m", { signal: controller.signal });

		expect(services).toHaveLength(4);
		expect(services.find((item) => item.name === "execution-control")).toMatchObject({
			dataState: "FRESH",
			status: "OUTAGE",
		});
		expect(services.find((item) => item.name === "app-api")?.status).toBe("HEALTHY");
		expect(telemetry.status).toBe("HEALTHY");
		expect(fetchFn).toHaveBeenCalledWith(
			"http://execution-control:8000/readyz",
			expect.objectContaining({
				headers: {
					accept: "application/json",
					authorization: "Bearer ops-web-token",
				},
			}),
		);
		expect(getTelemetrySnapshot).toHaveBeenCalledWith("15m", {
			now: new Date("2026-07-09T06:30:00.000Z"),
			signal: controller.signal,
		});
	});

	it("omits unconfigured health probes", async () => {
		const source = createOpsRuntimeSignalsSource({
			fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })),
			healthUrls: {},
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			axiom: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
		});

		const services = await source.getServices();

		expect(services).toEqual([]);
	});

	it("requires a valid readiness response before declaring a service healthy", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			const host = new URL(String(input)).hostname;
			if (host === "campus.example.test") {
				return new Response("<html>sign in</html>", { status: 200 });
			}
			if (host === "api.example.test") {
				return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
			}
			if (host === "execution-control") {
				return Response.json({ status: "degraded" }, { status: 503 });
			}
			return Response.json({ status: "ok" });
		});
		const source = createOpsRuntimeSignalsSource({
			fetchFn,
			healthUrls: {
				"agent-runtime": "http://agent-runtime:27062",
				"app-api": "https://api.example.test",
				"campus-web": "https://campus.example.test",
				"execution-control": "http://execution-control:8000",
			},
			axiom: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
		});

		const services = await source.getServices();

		expect(services.find((item) => item.name === "campus-web")).toMatchObject({
			dataState: "UNAVAILABLE",
			status: "UNKNOWN",
			updatedAt: null,
		});
		expect(services.find((item) => item.name === "app-api")).toMatchObject({
			dataState: "UNAVAILABLE",
			status: "UNKNOWN",
		});
		expect(services.find((item) => item.name === "execution-control")).toMatchObject({
			dataState: "FRESH",
			status: "OUTAGE",
		});
		expect(services.find((item) => item.name === "agent-runtime")).toMatchObject({
			dataState: "FRESH",
			status: "HEALTHY",
		});
	});

	it("treats connection failures as unavailable rather than confirmed outages", async () => {
		const source = createOpsRuntimeSignalsSource({
			fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection refused")),
			healthUrls: { "agent-runtime": "http://agent-runtime:27062" },
			axiom: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
		});

		await expect(source.getServices()).resolves.toEqual([
			expect.objectContaining({ dataState: "UNAVAILABLE", status: "UNKNOWN", updatedAt: null }),
		]);
	});

	it("omits endpoints that are not HTTP(S) root URLs", async () => {
		const fetchFn = vi.fn<typeof fetch>();
		const source = createOpsRuntimeSignalsSource({
			fetchFn,
			healthUrls: {
				"campus-web": "ftp://campus.example.test",
				"app-api": "https://api.example.test/healthz",
			},
			axiom: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
		});

		await expect(source.getServices()).resolves.toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
