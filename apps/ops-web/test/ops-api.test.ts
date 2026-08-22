// @vitest-environment node

import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";
import { describe, expect, it, vi } from "vitest";
import { createUnavailableDiningStore } from "../src/server/dining-store";
import { createFixtureOpsStatusStore } from "../src/server/fixture-ops-status-store";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createOpsOverviewService } from "../src/server/ops-overview-service";
import { SentryUnavailableError } from "../src/server/sentry-client";
import { opsSentryIssuesFixture } from "../src/shared/ops-fixtures";
import { createTestOpsApp } from "./helpers/ops-app";

function createTestApp(options?: { sentryFails?: boolean }) {
	const baseStore = createFixtureOpsStatusStore();
	const store = baseStore;
	const overviewService = createOpsOverviewService({
		now: () => new Date("2026-07-09T06:30:00.000Z"),
		store,
	});
	const queryRequestIssues = options?.sentryFails
		? vi.fn().mockRejectedValue(new SentryUnavailableError("Sentry unavailable"))
		: vi.fn().mockResolvedValue(opsSentryIssuesFixture);
	const app = createTestOpsApp({
		admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
		env: {
			OPS_WEB_CAMPUS_WEB_URL: "https://campus.example.test",
			OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
		},
		overviewService,
		sentry: { queryRequestIssues },
		store,
	});
	return {
		app,
		queryRequestIssues,
	};
}

describe("ops API", () => {
	it("requires the request status database but not the optional Dining database", async () => {
		const store = createFixtureOpsStatusStore();
		store.verifyReadiness = vi.fn().mockRejectedValue(new Error("database unavailable"));
		const unavailable = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			diningMapStore: createUnavailableDiningStore(new Error("dining unavailable")),
			env: {
				ACCESS_POLICY_AUD: "access-audience",
				ACCESS_TEAM_DOMAIN: "https://team.example.cloudflareaccess.com",
				OPS_WEB_AUTOMATION_ORIGIN: "https://ops-api.example.test",
				OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
			},
			store,
		});

		const unavailableResponse = await unavailable.request("/readyz");
		expect(unavailableResponse.status).toBe(503);
		expect(store.verifyReadiness).toHaveBeenCalledOnce();

		const ready = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			diningMapStore: createUnavailableDiningStore(new Error("dining unavailable")),
			env: {
				ACCESS_POLICY_AUD: "access-audience",
				ACCESS_TEAM_DOMAIN: "https://team.example.cloudflareaccess.com",
				OPS_WEB_AUTOMATION_ORIGIN: "https://ops-api.example.test",
				OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
			},
			store: createFixtureOpsStatusStore(),
		});
		expect((await ready.request("/readyz")).status).toBe(200);
	});

	it("keeps local readiness independent from Access and the automation endpoint", async () => {
		const app = createTestOpsApp({
			env: {
				DEPLOYMENT_ENVIRONMENT: "development",
				OPS_WEB_PUBLIC_ORIGIN: "http://127.0.0.1:5178",
			},
			store: createFixtureOpsStatusStore(),
		});

		const response = await app.request("http://127.0.0.1:5178/readyz");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, service: "ops-web" });
	});

	it("still requires Access and the public origin outside local development", async () => {
		const app = createTestOpsApp({
			env: { DEPLOYMENT_ENVIRONMENT: "staging" },
			store: createFixtureOpsStatusStore(),
		});

		const response = await app.request("/readyz");

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "OPS_WEB_NOT_READY",
				missing: ["ACCESS_TEAM_DOMAIN", "ACCESS_POLICY_AUD", "OPS_WEB_PUBLIC_ORIGIN"],
			},
		});
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
			expect(policy).toContain("connect-src 'self' blob: https://cdn.tldraw.com");
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
		const app = createTestOpsApp({
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

	it("does not retain the retired request log endpoint", async () => {
		const { app } = createTestApp();
		const response = await app.request("/api/ops/requests/req_ops_001/observability?kind=logs");

		expect(response.status).toBe(404);
	});

	it("returns trusted Sentry issue summaries under unified Ops admission", async () => {
		const { app, queryRequestIssues } = createTestApp();
		const response = await app.request("/api/ops/requests/req_ops_001/sentry-issues");

		expect(response.status).toBe(200);
		expect(queryRequestIssues).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_ops_001",
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
