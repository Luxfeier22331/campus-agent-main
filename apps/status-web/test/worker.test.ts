import { describe, expect, it, vi } from "vitest";

import { createStatusWorker, runStatusCycle, statusCacheControl } from "../src/index";
import { resolveStatusRuntimeConfig } from "../src/status/config";
import { createMemorySnapshotStore } from "../src/status/store";

function assetResponse(request: Request): Response {
	if (new URL(request.url).pathname === "/") {
		return new Response("<!doctype html><html><body>status</body></html>", {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}
	return new Response("not found", { status: 404 });
}

describe("status worker", () => {
	it("bounds cache lifetime to the snapshot expiry", () => {
		const now = new Date("2026-08-07T00:05:00.000Z");
		expect(statusCacheControl("2026-08-07T00:06:01.000Z", now)).toBe(
			"public, max-age=30, s-maxage=60, must-revalidate",
		);
		expect(statusCacheControl("2026-08-07T00:05:10.999Z", now)).toBe(
			"public, max-age=10, s-maxage=10, must-revalidate",
		);
		expect(statusCacheControl("2026-08-07T00:05:00.999Z", now)).toBe("no-store");
		expect(statusCacheControl("2026-08-07T00:05:00.000Z", now)).toBe("no-store");
		expect(statusCacheControl("not-a-date", now)).toBe("no-store");
	});

	it("reports every readiness error without probing external origins", async () => {
		const fetchFn = vi.fn();
		const worker = createStatusWorker({ fetchFn });
		const response = await worker.fetch(new Request("https://status.muc.wiki/readyz"), {
			DEPLOYMENT_ENVIRONMENT: "production-like",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				details: {
					missing: [
						"DEPLOYMENT_ENVIRONMENT",
						"ASSETS binding",
						"STATUS_CAMPUS_ORIGIN",
						"STATUS_QA_ORIGIN",
						"CAMPUS_WEB_PUBLIC_ORIGIN",
					],
				},
			},
		});
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("returns ready for complete development and production bindings", async () => {
		const worker = createStatusWorker();
		const development = await worker.fetch(new Request("https://status.muc.wiki/readyz"), {
			ASSETS: { fetch: assetResponse },
			CAMPUS_WEB_PUBLIC_ORIGIN: "http://127.0.0.1:27014",
			DEPLOYMENT_ENVIRONMENT: "development",
			STATUS_CAMPUS_ORIGIN: "http://127.0.0.1:27014",
			STATUS_QA_ORIGIN: "http://127.0.0.1:27031",
		});
		expect(development.status).toBe(200);
		await expect(development.json()).resolves.toEqual({ status: "ready" });

		const production = await worker.fetch(new Request("https://status.muc.wiki/readyz"), {
			ASSETS: { fetch: assetResponse },
			CAMPUS_WEB_PUBLIC_ORIGIN: "https://campus.example.test",
			DEPLOYMENT_ENVIRONMENT: "production",
			STATUS_CAMPUS_ORIGIN: "https://probe.example.test",
			STATUS_QA_ORIGIN: "https://api.example.test",
			STATUS_SNAPSHOT: { get: async () => null, put: async () => undefined },
		});
		expect(production.status).toBe(200);
	});

	it("normalizes development environment whitespace for local snapshot storage", async () => {
		const worker = createStatusWorker();
		const response = await worker.fetch(new Request("https://status.muc.wiki/api/status"), {
			ASSETS: { fetch: assetResponse },
			CAMPUS_WEB_PUBLIC_ORIGIN: "http://127.0.0.1:27014",
			DEPLOYMENT_ENVIRONMENT: "  development  ",
			STATUS_CAMPUS_ORIGIN: "http://127.0.0.1:27014",
			STATUS_QA_ORIGIN: "http://127.0.0.1:27031",
		});

		expect(response.status).toBe(204);
	});

	it("requires HTTPS origins and KV outside development", async () => {
		const worker = createStatusWorker();
		const response = await worker.fetch(new Request("https://status.muc.wiki/readyz"), {
			ASSETS: { fetch: assetResponse },
			CAMPUS_WEB_PUBLIC_ORIGIN: "http://campus.example.test",
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATUS_CAMPUS_ORIGIN: "http://probe.example.test",
			STATUS_QA_ORIGIN: "http://api.example.test",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				details: {
					missing: [
						"STATUS_CAMPUS_ORIGIN",
						"STATUS_QA_ORIGIN",
						"CAMPUS_WEB_PUBLIC_ORIGIN",
						"STATUS_SNAPSHOT binding",
					],
				},
			},
		});
	});
	it("returns 204 before the first scheduled publication", async () => {
		const store = createMemorySnapshotStore();
		const worker = createStatusWorker({ store });
		const response = await worker.fetch(new Request("https://status.muc.wiki/api/status"), {
			ASSETS: { fetch: assetResponse },
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
			STATUS_QA_ORIGIN: "https://api.example.test",
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.text()).resolves.toBe("");
	});

	it("redirects only the fixed campus navigation entries", async () => {
		const worker = createStatusWorker();
		const env = {
			ASSETS: { fetch: assetResponse },
			CAMPUS_WEB_PUBLIC_ORIGIN: "https://campus.muc.wiki",
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATUS_CAMPUS_ORIGIN: "https://campus.muc.wiki",
			STATUS_QA_ORIGIN: "https://api.muc.wiki",
		};

		const root = await worker.fetch(new Request("https://status.muc.wiki/go/campus/"), env);
		expect(root.status).toBe(302);
		expect(root.headers.get("location")).toBe("https://campus.muc.wiki/");
		expect(root.headers.get("cache-control")).toBe("no-store");

		const docs = await worker.fetch(new Request("https://status.muc.wiki/go/campus/docs"), env);
		expect(docs.headers.get("location")).toBe("https://campus.muc.wiki/docs");

		const query = await worker.fetch(
			new Request("https://status.muc.wiki/go/campus/docs?next=/map"),
			env,
		);
		expect(query.status).toBe(404);

		const arbitrary = await worker.fetch(
			new Request("https://status.muc.wiki/go/campus/other"),
			env,
		);
		expect(arbitrary.status).toBe(404);
	});

	it("fails closed when the campus navigation origin is missing", async () => {
		const worker = createStatusWorker();
		const response = await worker.fetch(new Request("https://status.muc.wiki/go/campus/"), {
			ASSETS: { fetch: assetResponse },
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATUS_CAMPUS_ORIGIN: "https://campus.muc.wiki",
			STATUS_QA_ORIGIN: "https://api.muc.wiki",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: { details: { missing: ["CAMPUS_WEB_PUBLIC_ORIGIN"] } },
		});
	});

	it("returns 204 for an empty development snapshot", async () => {
		const store = createMemorySnapshotStore();
		const now = new Date("2026-08-07T00:05:00.000Z");
		const worker = createStatusWorker({ now: () => now, store });
		const env = {
			ASSETS: { fetch: assetResponse },
			DEPLOYMENT_ENVIRONMENT: "development",
			STATUS_CAMPUS_ORIGIN: "http://127.0.0.1:27014",
			STATUS_QA_ORIGIN: "http://127.0.0.1:27031",
		};

		const first = await worker.fetch(new Request("https://status.muc.wiki/api/status"), env);
		expect(first.status).toBe(204);
		expect(first.headers.get("etag")).toBeNull();
	});

	it("publishes a snapshot from public endpoint probes and exposes ETags", async () => {
		const store = createMemorySnapshotStore();
		const now = new Date("2026-08-07T00:05:00Z");
		const requestedUrls: string[] = [];
		const cycleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const fetchFn = async (input: RequestInfo | URL) => {
			const url = new URL(input.toString());
			const pathname = url.pathname;
			requestedUrls.push(url.toString());
			if (pathname === "/") {
				return new Response("<!doctype html><html></html>", {
					headers: { "content-type": "text/html" },
				});
			}
			if (pathname === "/readyz") {
				return new Response("not found", { status: 404 });
			}
			if (pathname === "/api/chat/availability") {
				return Response.json({ status: "operational" });
			}
			return new Response("not found", { status: 404 });
		};
		await runStatusCycle({
			config: resolveStatusRuntimeConfig({
				DEPLOYMENT_ENVIRONMENT: "staging",
				STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
				STATUS_QA_ORIGIN: "https://api.example.test",
			}),
			fetchFn,
			htmlParser: async () => ({
				moduleScriptSources: ["/src/main.tsx"],
				rootMountCount: 1,
				title: "MUC Campus",
			}),
			now,
			store,
		});
		expect(requestedUrls.sort()).toEqual([
			"https://api.example.test/api/chat/availability",
			"https://campus.example.test/",
		]);
		expect(cycleLog).toHaveBeenCalledTimes(1);
		expect(cycleLog).toHaveBeenCalledWith({
			environment: "staging",
			event: "status.probe_cycle",
			generated_at: "2026-08-07T00:05:00.000Z",
			observations: [
				{
					error: null,
					http: 200,
					latency_ms: expect.any(Number),
					probe: "campus-qa-availability",
					result: "passed",
					service: "campus.qa",
				},
				{
					error: null,
					http: 200,
					latency_ms: expect.any(Number),
					probe: "campus-web-shell",
					result: "passed",
					service: "campus.services",
				},
			],
			source: "status-web.cron",
		});
		cycleLog.mockRestore();

		const worker = createStatusWorker({ store, now: () => now });
		const first = await worker.fetch(new Request("https://status.muc.wiki/api/status"), {
			ASSETS: { fetch: assetResponse },
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
			STATUS_QA_ORIGIN: "https://api.example.test",
		});
		const etag = first.headers.get("etag");
		expect(first.status).toBe(200);
		expect(etag).toBeTruthy();
		expect(first.headers.get("cache-control")).toContain("must-revalidate");
		await expect(first.json()).resolves.toMatchObject({
			services: [
				{ id: "campus.qa", name: "校园问答", status: "operational" },
				{ id: "campus.services", name: "其他服务", status: "operational" },
			],
		});

		const second = await worker.fetch(
			new Request("https://status.muc.wiki/api/status", {
				headers: { "if-none-match": etag ?? "" },
			}),
			{
				ASSETS: { fetch: assetResponse },
				CAMPUS_WEB_PUBLIC_ORIGIN: "https://campus.example.test",
				DEPLOYMENT_ENVIRONMENT: "staging",
				STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
				STATUS_QA_ORIGIN: "https://api.example.test",
			},
		);
		expect(second.status).toBe(304);
		expect(second.headers.get("cache-control")).toContain("must-revalidate");
	});

	it("logs a scheduled cycle failure and rethrows it", async () => {
		const cycleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const worker = createStatusWorker();

		await expect(
			worker.scheduled({} as ScheduledController, {
				DEPLOYMENT_ENVIRONMENT: "staging",
			}),
		).rejects.toThrow("STATUS_CAMPUS_ORIGIN");
		expect(cycleError).toHaveBeenCalledWith({
			error_type: "Error",
			event: "status.probe_cycle_failed",
			source: "status-web.cron",
		});
		cycleError.mockRestore();
	});

	it("marks an expired snapshot unknown while preserving its timeline", async () => {
		const store = createMemorySnapshotStore({
			environment: "staging",
			expiresAt: "2026-08-07T00:10:00.000Z",
			generatedAt: "2026-08-07T00:05:00.000Z",
			schemaVersion: "product-availability-snapshot.v1",
			services: [
				{
					checkedAt: "2026-08-07T00:05:00.000Z",
					id: "campus.qa",
					name: "校园问答",
					status: "operational",
					timeline: [{ day: "2026-08-07", status: "operational" }],
				},
				{
					checkedAt: "2026-08-07T00:05:00.000Z",
					id: "campus.services",
					name: "其他服务",
					status: "operational",
					timeline: [{ day: "2026-08-07", status: "operational" }],
				},
			],
		});
		const worker = createStatusWorker({
			now: () => new Date("2026-08-07T00:11:00.000Z"),
			store,
		});
		const response = await worker.fetch(new Request("https://status.muc.wiki/api/status"), {
			ASSETS: { fetch: assetResponse },
			CAMPUS_WEB_PUBLIC_ORIGIN: "https://campus.example.test",
			DEPLOYMENT_ENVIRONMENT: "staging",
			STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
			STATUS_QA_ORIGIN: "https://api.example.test",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			services: [
				{ id: "campus.qa", status: "unknown" },
				{ id: "campus.services", status: "unknown" },
			],
		});
	});

	it("reports an invalid deployment environment as not ready", async () => {
		const worker = createStatusWorker();
		const response = await worker.fetch(new Request("https://status.muc.wiki/readyz"), {
			ASSETS: { fetch: assetResponse },
			DEPLOYMENT_ENVIRONMENT: "production-like",
			STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
			STATUS_QA_ORIGIN: "https://api.example.test",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			error: { details: { missing: expect.arrayContaining(["DEPLOYMENT_ENVIRONMENT"]) } },
		});
	});
});
