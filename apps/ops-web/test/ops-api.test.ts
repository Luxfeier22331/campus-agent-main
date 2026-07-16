// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import type { InternalPortalAuthMaintenanceClient } from "../src/server/internal-portal-auth-maintenance-client";
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

function createTestApp(options?: {
	auditWriteFails?: boolean;
	credentialStatus?: { configured: boolean; updatedAt: string | null; updatedBy: string | null };
	maintenanceStatus?: Awaited<ReturnType<InternalPortalAuthMaintenanceClient["getStatus"]>>;
	rawAllowed?: boolean;
	resumeError?: Error;
}) {
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
	const getStatus = vi.fn().mockResolvedValue(
		options?.credentialStatus ?? {
			configured: false,
			updatedAt: null,
			updatedBy: null,
		},
	);
	const replaceCredential = vi.fn(async (input) => ({
		configured: true,
		updatedAt: input.updatedAt,
		updatedBy: input.updatedBy,
	}));
	const maintenanceStatus = options?.maintenanceStatus ?? {
		errorCode: null,
		lastAttemptAt: "2026-07-15T12:30:00.000Z",
		lastOutcome: "SUCCESS" as const,
		lastSuccessAt: "2026-07-15T12:30:03.000Z",
		nextRunAt: "2026-07-15T13:00:00.000Z",
		noticeProbeSucceeded: true,
		portalSessionEstablished: true,
		scheduleState: "ACTIVE" as const,
		serviceTicketIssued: true,
	};
	const resume = options?.resumeError
		? vi.fn().mockRejectedValue(options.resumeError)
		: vi.fn().mockResolvedValue(maintenanceStatus);
	const app = createOpsApp({
		admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
		env: options?.rawAllowed
			? { OPS_WEB_RAW_HUMAN_OPERATOR_EMAIL_ALLOWLIST: "ops@example.test" }
			: {},
		openObserve,
		overviewService,
		internalPortalAuthStore: { getStatus, replaceCredential },
		internalPortalMaintenanceClient: {
			getStatus: vi.fn().mockResolvedValue(maintenanceStatus),
			resume,
		},
		store,
	});
	return { app, getStatus, queryRequest, replaceCredential, resume, writeObservabilityReadAudit };
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

	it("reads and replaces the internal portal credential without echoing it", async () => {
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const { app, replaceCredential, resume } = createTestApp();
		const status = await app.request("/api/ops/internal-portal-auth");
		const response = await app.request("https://ops.example.test/api/ops/internal-portal-auth", {
			body: JSON.stringify({
				credential: "nginx=proxy; SSO_TGC=TGT-private-ticket; JSESSIONID=session",
			}),
			headers: { "content-type": "application/json", origin: "https://ops.example.test" },
			method: "PUT",
		});

		expect(status.status).toBe(200);
		expect(response.status).toBe(200);
		const responseBody = await response.json();
		expect(JSON.stringify(responseBody)).not.toContain("TGT-private-ticket");
		expect(replaceCredential).toHaveBeenCalledWith(
			expect.objectContaining({
				credential: "TGT-private-ticket",
				updatedBy: "ops@example.test",
			}),
		);
		expect(resume).toHaveBeenCalledOnce();
		expect(responseBody).toMatchObject({
			maintenance: { lastOutcome: "SUCCESS", scheduleState: "ACTIVE" },
			observedLifetime: { lowerBoundSeconds: null, upperBoundSeconds: null },
		});
		expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain("TGT-private-ticket");
		consoleInfo.mockRestore();
	});

	it("reports the observed credential lifetime bounds", async () => {
		const { app } = createTestApp({
			credentialStatus: {
				configured: true,
				updatedAt: "2026-07-15T12:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			maintenanceStatus: {
				errorCode: "internal_portal_credential_expired",
				lastAttemptAt: "2026-07-16T12:30:00.100Z",
				lastOutcome: "CREDENTIAL_EXPIRED",
				lastSuccessAt: "2026-07-16T12:00:00.900Z",
				nextRunAt: null,
				noticeProbeSucceeded: false,
				portalSessionEstablished: false,
				scheduleState: "PAUSED",
				serviceTicketIssued: false,
			},
		});

		const response = await app.request("/api/ops/internal-portal-auth");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			observedLifetime: {
				lowerBoundSeconds: 86_400,
				upperBoundSeconds: 88_201,
			},
		});
	});

	it("keeps a successful credential replacement when schedule resume is unavailable", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { app, replaceCredential } = createTestApp({
			resumeError: new Error("temporal unavailable"),
		});

		const response = await app.request("https://ops.example.test/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "TGT-replacement-ticket" }),
			headers: { "content-type": "application/json", origin: "https://ops.example.test" },
			method: "PUT",
		});

		expect(response.status).toBe(200);
		expect(replaceCredential).toHaveBeenCalledOnce();
		await expect(response.json()).resolves.toMatchObject({
			configured: true,
			maintenance: { scheduleState: "UNAVAILABLE" },
		});
		consoleError.mockRestore();
	});

	it("rejects cross-origin, ambiguous, and oversized credential updates", async () => {
		const { app, replaceCredential } = createTestApp();
		const crossOrigin = await app.request("https://ops.example.test/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "TGT-private-ticket" }),
			headers: { "content-type": "application/json", origin: "https://other.example.test" },
			method: "PUT",
		});
		const ambiguous = await app.request("https://ops.example.test/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "SSO_TGC=TGT-one; SSO_TGC=TGT-two" }),
			headers: { "content-type": "application/json", origin: "https://ops.example.test" },
			method: "PUT",
		});
		const oversized = await app.request("https://ops.example.test/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "x".repeat(9 * 1024) }),
			headers: { "content-type": "application/json", origin: "https://ops.example.test" },
			method: "PUT",
		});

		expect(crossOrigin.status).toBe(403);
		expect(ambiguous.status).toBe(400);
		expect(oversized.status).toBe(400);
		expect(replaceCredential).not.toHaveBeenCalled();
	});

	it("does not allow a service operator to manage the portal credential", async () => {
		const replaceCredential = vi.fn();
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ principalClass: "service" }),
			internalPortalAuthStore: {
				getStatus: vi.fn(),
				replaceCredential,
			},
			openObserve: {
				getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
				queryRequest: vi.fn(),
			},
			overviewService: { getOverview: vi.fn().mockResolvedValue(opsOverviewFixture) },
			store: createFixtureOpsStatusStore(),
		});

		expect((await app.request("/api/ops/internal-portal-auth")).status).toBe(403);
		expect(replaceCredential).not.toHaveBeenCalled();
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
