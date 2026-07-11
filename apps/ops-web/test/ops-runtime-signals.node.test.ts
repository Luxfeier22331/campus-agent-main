// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsRuntimeSignalsSource } from "../src/server/ops-runtime-signals";
import { opsOverviewFixture } from "../src/shared/ops-fixtures";

describe("ops runtime signals", () => {
	it("checks fixed service endpoints and preserves partial failures", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			const url = String(input);
			return new Response(null, { status: url.includes("execution-control") ? 503 : 200 });
		});
		const source = createOpsRuntimeSignalsSource({
			fetchFn,
			healthUrls: {
				"agent-runtime": "http://agent-runtime:27062/readyz",
				"app-api": "https://api.example.test/healthz",
				"campus-web": "https://campus.example.test/",
				"execution-control": "http://execution-control:8000/readyz",
				"ops-web": "http://127.0.0.1:5178/healthz",
			},
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			openObserve: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
		});

		const snapshot = await source.getSnapshot("15m");

		expect(snapshot.services).toHaveLength(5);
		expect(snapshot.services.find((item) => item.name === "execution-control")).toMatchObject({
			dataState: "FRESH",
			status: "OUTAGE",
		});
		expect(snapshot.services.find((item) => item.name === "app-api")?.status).toBe("HEALTHY");
		expect(snapshot.telemetry.status).toBe("HEALTHY");
	});

	it("marks a missing health URL unavailable without failing other services", async () => {
		const source = createOpsRuntimeSignalsSource({
			fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })),
			healthUrls: {},
			now: () => new Date("2026-07-09T06:30:00.000Z"),
			openObserve: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
		});

		const snapshot = await source.getSnapshot("15m");

		expect(snapshot.services.every((item) => item.status === "UNKNOWN")).toBe(true);
		expect(snapshot.services.every((item) => item.dataState === "UNAVAILABLE")).toBe(true);
	});
});
