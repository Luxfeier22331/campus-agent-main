// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createOpsOverviewService } from "../src/server/ops-overview-service";
import {
	createFixtureOpsStatusStore,
	OpsStatusStoreUnavailableError,
} from "../src/server/ops-status-store";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures";

function createTestApp(options?: { auditWriteFails?: boolean; rawAllowed?: boolean }) {
	const baseStore = createFixtureOpsStatusStore();
	const writeObservabilityReadAudit = options?.auditWriteFails
		? vi.fn().mockRejectedValue(new OpsStatusStoreUnavailableError("AUDIT_WRITE_DENIED", "denied"))
		: vi.fn(baseStore.writeObservabilityReadAudit);
	const store = { ...baseStore, writeObservabilityReadAudit };
	const queryRequest = vi.fn(async (input: { kind: "logs" | "trace" }) =>
		input.kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
	);
	const openObserve = {
		getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
		queryRequest,
	};
	const overviewService = createOpsOverviewService({
		now: () => new Date("2026-07-09T06:30:00.000Z"),
		signals: {
			getSnapshot: vi.fn().mockResolvedValue({
				services: opsOverviewFixture.services,
				telemetry: opsOverviewFixture.telemetry,
			}),
		},
		store,
	});
	const app = createOpsApp({
		admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
		env: options?.rawAllowed
			? { OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.test" }
			: {},
		openObserve,
		overviewService,
		store,
	});
	return { app, queryRequest, writeObservabilityReadAudit };
}

describe("ops API", () => {
	it("sets restrictive security headers on every response class", async () => {
		const { app } = createTestApp();
		const responses = await Promise.all([
			app.request("/healthz"),
			app.request("/api/ops/overview?window=1h"),
			app.request("/missing-page"),
		]);

		for (const response of responses) {
			const policy = response.headers.get("content-security-policy") ?? "";
			expect(policy).toContain("default-src 'self'");
			expect(policy).toContain("frame-ancestors 'none'");
			expect(policy).toContain("object-src 'none'");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("x-frame-options")).toBe("DENY");
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("permissions-policy")).toContain("camera=()");
			expect(response.headers.get("permissions-policy")).toContain("microphone=()");
			expect(response.headers.get("strict-transport-security")).toBeNull();
		}
	});

	it("serves a cached overview and validates its window", async () => {
		const { app } = createTestApp();
		const response = await app.request("/api/ops/overview?window=1h");
		const invalid = await app.request("/api/ops/overview?window=30d");

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ window: "1h" });
		expect(response.headers.get("cache-control")).toContain("max-age=15");
		expect(invalid.status).toBe(400);
	});

	it("uses a one-hour request window by default", async () => {
		const { app } = createTestApp();
		const response = await app.request("/api/ops/requests");

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ window: "1h" });
	});

	it("does not retain the runtime or evidence routes", async () => {
		const { app } = createTestApp();

		expect((await app.request("/api/ops/runtime")).status).toBe(404);
		expect((await app.request("/api/ops/evidence/ev_001")).status).toBe(404);
	});

	it("requires the separate raw observability allowlist", async () => {
		const { app, queryRequest } = createTestApp();
		const response = await app.request("/api/ops/requests/req_ops_001/observability?kind=logs");

		expect(response.status).toBe(403);
		expect(queryRequest).not.toHaveBeenCalled();
	});

	it("rejects browser-supplied trace ids and stream names", async () => {
		const { app, queryRequest } = createTestApp({ rawAllowed: true });
		const response = await app.request(
			"/api/ops/requests/req_ops_001/observability?kind=logs&traceId=browser-trace&stream=x",
		);

		expect(response.status).toBe(400);
		expect(queryRequest).not.toHaveBeenCalled();
	});

	it("queries by the stored trace id and audits before returning raw records", async () => {
		const { app, queryRequest, writeObservabilityReadAudit } = createTestApp({ rawAllowed: true });
		const response = await app.request("/api/ops/requests/req_ops_001/observability?kind=trace");

		expect(response.status).toBe(200);
		expect(queryRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "trace",
				requestId: "req_ops_001",
				traceId: "trace_ops_001",
			}),
		);
		expect(writeObservabilityReadAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "trace",
				recordCount: 1,
				requestId: "req_ops_001",
				traceId: "trace_ops_001",
			}),
		);
	});

	it("refuses raw records when the read audit cannot be written", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { app, queryRequest, writeObservabilityReadAudit } = createTestApp({
			auditWriteFails: true,
			rawAllowed: true,
		});

		const response = await app.request("/api/ops/requests/req_ops_001/observability?kind=logs");

		expect(queryRequest).toHaveBeenCalledOnce();
		expect(writeObservabilityReadAudit).toHaveBeenCalledOnce();
		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_STATUS_STORE_UNAVAILABLE", reasonCode: "AUDIT_WRITE_DENIED" },
		});
		consoleError.mockRestore();
	});
});
