// @vitest-environment node

import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";
import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { AxiomUnavailableError } from "../src/server/axiom-client";
import { createUnavailableDiningStore } from "../src/server/dining-store";
import type { InternalPortalAuthMaintenanceClient } from "../src/server/ingestion-control-client";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createOpsOverviewService } from "../src/server/ops-overview-service";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store";
import { SentryUnavailableError } from "../src/server/sentry-client";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsSentryIssuesFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures";

function createTestApp(options?: {
	credentialStatus?: { configured: boolean; updatedAt: string | null; updatedBy: string | null };
	maintenanceStatus?: Awaited<ReturnType<InternalPortalAuthMaintenanceClient["getStatus"]>>;
	publicOrigin?: string;
	queryFails?: boolean;
	validationError?: Error;
	sentryFails?: boolean;
}) {
	const baseStore = createFixtureOpsStatusStore();
	const store = baseStore;
	const queryRequest = options?.queryFails
		? vi.fn().mockRejectedValue(new AxiomUnavailableError("partial result"))
		: vi.fn(async (input: { kind: "logs" | "trace" }) =>
				input.kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture,
			);
	const axiom = {
		getTelemetrySnapshot: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
		queryRequest,
	};
	const overviewService = createOpsOverviewService({
		now: () => new Date("2026-07-09T06:30:00.000Z"),
		signals: {
			getServices: vi.fn().mockResolvedValue(opsOverviewFixture.services),
			getTelemetry: vi.fn().mockResolvedValue(opsOverviewFixture.telemetry),
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
	const validate = options?.validationError
		? vi.fn().mockRejectedValue(options.validationError)
		: vi.fn().mockResolvedValue(maintenanceStatus);
	const queryRequestIssues = options?.sentryFails
		? vi.fn().mockRejectedValue(new SentryUnavailableError("Sentry unavailable"))
		: vi.fn().mockResolvedValue(opsSentryIssuesFixture);
	const app = createOpsApp({
		admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
		env: {
			OPS_WEB_CAMPUS_WEB_PUBLIC_ORIGIN: "https://campus.example.test",
			OPS_WEB_PUBLIC_ORIGIN: options?.publicOrigin ?? "https://ops.example.test",
		},
		axiom,
		overviewService,
		internalPortalAuthStore: { getStatus, replaceCredential },
		internalPortalMaintenanceClient: {
			getStatus: vi.fn().mockResolvedValue(maintenanceStatus),
			validate,
		},
		sentry: { queryRequestIssues },
		store,
	});
	return {
		app,
		getStatus,
		queryRequest,
		queryRequestIssues,
		replaceCredential,
		validate,
	};
}

describe("ops API", () => {
	it("requires the request status database but not the optional Dining database", async () => {
		const store = createFixtureOpsStatusStore();
		store.verifyReadiness = vi.fn().mockRejectedValue(new Error("database unavailable"));
		const unavailable = createOpsApp({
			admission: createAllowAllOpsAdmission(),
			diningStore: createUnavailableDiningStore(new Error("dining unavailable")),
			env: {
				ACCESS_POLICY_AUD: "access-audience",
				ACCESS_TEAM_DOMAIN: "https://team.example.cloudflareaccess.com",
				OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
			},
			store,
		});

		const unavailableResponse = await unavailable.request("/readyz");
		expect(unavailableResponse.status).toBe(503);
		expect(store.verifyReadiness).toHaveBeenCalledOnce();

		const ready = createOpsApp({
			admission: createAllowAllOpsAdmission(),
			diningStore: createUnavailableDiningStore(new Error("dining unavailable")),
			env: {
				ACCESS_POLICY_AUD: "access-audience",
				ACCESS_TEAM_DOMAIN: "https://team.example.cloudflareaccess.com",
				OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
			},
			store: createFixtureOpsStatusStore(),
		});
		expect((await ready.request("/readyz")).status).toBe(200);
	});

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
			expect(response.headers.get("strict-transport-security")).toContain("max-age=");
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

	it("rejects legacy and cross-view cursors while allowing status filters in attention view", async () => {
		const { app } = createTestApp();
		const recentCursor = Buffer.from(
			JSON.stringify({
				requestId: "req_ops_001",
				startedAt: "2026-07-09T06:29:00.000Z",
				v: 1,
				view: "recent",
			}),
		).toString("base64url");
		const legacyCursor = Buffer.from(
			JSON.stringify({
				requestId: "req_ops_001",
				startedAt: "2026-07-09T06:29:00.000Z",
				v: 1,
			}),
		).toString("base64url");
		const responses = await Promise.all([
			app.request(`/api/ops/requests?view=attention&cursor=${encodeURIComponent(recentCursor)}`),
			app.request(`/api/ops/requests?cursor=${encodeURIComponent(legacyCursor)}`),
		]);

		for (const response of responses) {
			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toMatchObject({
				error: { code: "OPS_INVALID_QUERY" },
			});
		}
		const completedAttention = await app.request(
			"/api/ops/requests?view=attention&status=COMPLETED",
		);
		expect(completedAttention.status).toBe(200);
		expect(await completedAttention.json()).toMatchObject({ view: "attention" });
	});

	it("does not retain the runtime or evidence routes", async () => {
		const { app } = createTestApp();

		expect((await app.request("/api/ops/runtime")).status).toBe(404);
		expect((await app.request("/api/ops/evidence/ev_001")).status).toBe(404);
	});

	it("forwards campus groups reads and same-origin group writes", async () => {
		const catalog: CampusGroupsCatalog = {
			schemaVersion: "campus-groups-catalog.v1" as const,
			sections: [
				{
					id: "interest-groups",
					name: "同好群",
					groups: [
						{
							id: "qq-760540871",
							joinUrl: null,
							name: "央民二匹马俱乐部",
							qqGroupNumber: "760540871",
							summary: "优俊少女",
							tags: ["优俊少女"],
						},
					],
				},
			],
		};
		const campusGroupsClient = {
			getCatalog: vi.fn().mockResolvedValue(catalog),
			replaceCatalog: vi.fn().mockResolvedValue(catalog),
		};
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			campusGroupsClient,
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			store: createFixtureOpsStatusStore(),
		});
		const writeHeaders = {
			"content-type": "application/json",
			origin: "https://ops.example.test",
		};

		const responses = await Promise.all([
			app.request("/api/ops/groups/catalog"),
			app.request("https://ops.example.test/api/ops/groups/catalog", {
				body: JSON.stringify(catalog),
				headers: writeHeaders,
				method: "PUT",
			}),
		]);

		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		expect(campusGroupsClient.getCatalog).toHaveBeenCalledWith();
		expect(campusGroupsClient.replaceCatalog).toHaveBeenCalledWith(catalog);
	});

	it("reads and replaces the internal portal credential without echoing it", async () => {
		const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const { app, replaceCredential, validate } = createTestApp();
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
		expect(validate).toHaveBeenCalledWith("ops@example.test");
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

	it("keeps a successful credential replacement when immediate validation is unavailable", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { app, replaceCredential } = createTestApp({
			validationError: new Error("temporal unavailable"),
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

	it("uses the configured HTTPS public origin instead of proxy forwarding headers", async () => {
		const { app, replaceCredential } = createTestApp();
		const accepted = await app.request("http://ops-web:5178/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "SSO_TGC=TGT-private-ticket" }),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
				"sec-fetch-site": "same-origin",
				"x-forwarded-host": "attacker.example.test",
				"x-forwarded-proto": "http",
			},
			method: "PUT",
		});
		const rejected = await app.request("http://ops-web:5178/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "SSO_TGC=TGT-private-ticket" }),
			headers: {
				"content-type": "application/json",
				host: "ops.example.test",
				origin: "https://attacker.example.test",
				"x-forwarded-host": "ops.example.test",
				"x-forwarded-proto": "https",
			},
			method: "PUT",
		});

		expect(accepted.status).toBe(200);
		expect(rejected.status).toBe(403);
		expect(replaceCredential).toHaveBeenCalledOnce();
	});

	it("rejects browser writes when the configured public origin is not HTTPS", async () => {
		const replaceCredential = vi.fn();
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			env: { OPS_WEB_PUBLIC_ORIGIN: "http://ops.example.test" },
			internalPortalAuthStore: { getStatus: vi.fn(), replaceCredential },
		});
		const response = await app.request("http://ops-web:5178/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "SSO_TGC=TGT-private-ticket" }),
			headers: { "content-type": "application/json", origin: "http://ops.example.test" },
			method: "PUT",
		});

		expect(response.status).toBe(403);
		expect(replaceCredential).not.toHaveBeenCalled();
	});

	it("accepts an explicitly configured loopback HTTP origin for local development", async () => {
		const { app, replaceCredential } = createTestApp({
			publicOrigin: "http://127.0.0.1:4178",
		});
		const response = await app.request("http://127.0.0.1:4178/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential: "SSO_TGC=TGT-private-ticket" }),
			headers: {
				"content-type": "application/json",
				origin: "http://127.0.0.1:4178",
				"sec-fetch-site": "same-origin",
			},
			method: "PUT",
		});

		expect(response.status).toBe(200);
		expect(replaceCredential).toHaveBeenCalledOnce();
	});
	it("rejects all browser-supplied APL, dataset, window, limit, and trace parameters", async () => {
		const { app, queryRequest } = createTestApp();
		const response = await app.request(
			"/api/ops/requests/req_ops_001/observability?kind=logs&apl=x&dataset=x&from=0&limit=1000&to=1&traceId=browser-trace",
		);

		expect(response.status).toBe(400);
		expect(queryRequest).not.toHaveBeenCalled();
	});

	it("queries fixed Axiom records by the stored request identity", async () => {
		const { app, queryRequest } = createTestApp();
		const response = await app.request("/api/ops/requests/req_ops_001/observability?kind=trace");

		expect(response.status).toBe(200);
		expect(queryRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "trace",
				requestId: "req_ops_001",
				signal: expect.any(AbortSignal),
				traceId: "trace_ops_001",
			}),
		);
		await expect(response.json()).resolves.toMatchObject({ source: "AXIOM" });
	});

	it("returns unavailable instead of partial Axiom records", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { app } = createTestApp({
			queryFails: true,
		});

		const response = await app.request("/api/ops/requests/req_ops_001/observability?kind=logs");

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_OBSERVABILITY_UNAVAILABLE" },
		});
		consoleError.mockRestore();
	});

	it("returns trusted Sentry issue summaries under unified Ops admission", async () => {
		const { app, queryRequestIssues } = createTestApp();
		const response = await app.request("/api/ops/requests/req_ops_001/sentry-issues");

		expect(response.status).toBe(200);
		expect(queryRequestIssues).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_ops_001",
				traceId: "trace_ops_001",
			}),
		);
		await expect(response.json()).resolves.toMatchObject({ source: "SENTRY" });
	});

	it("rejects browser-supplied Sentry query controls", async () => {
		const { app, queryRequestIssues } = createTestApp();
		const response = await app.request(
			"/api/ops/requests/req_ops_001/sentry-issues?query=x&project=x&start=0&limit=100",
		);

		expect(response.status).toBe(400);
		expect(queryRequestIssues).not.toHaveBeenCalled();
	});

	it("does not query Sentry for an unknown request", async () => {
		const { app, queryRequestIssues } = createTestApp();
		const response = await app.request("/api/ops/requests/req_missing/sentry-issues");

		expect(response.status).toBe(404);
		expect(queryRequestIssues).not.toHaveBeenCalled();
	});

	it("maps Sentry API failures to a dedicated unavailable response", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { app } = createTestApp({ sentryFails: true });
		const response = await app.request("/api/ops/requests/req_ops_001/sentry-issues");

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "OPS_SENTRY_UNAVAILABLE" },
		});
		consoleError.mockRestore();
	});
});
