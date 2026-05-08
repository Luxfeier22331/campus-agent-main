import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDocsRoot = join(__dirname, "..");

function readOptional(relativePath: string): string {
	const targetPath = join(publicDocsRoot, relativePath);
	return existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
}

const wranglerConfig = readOptional("wrangler.toml");
const wranglerLocalSmokeConfig = readOptional("wrangler.local-smoke.toml");
const packageManifest = JSON.parse(readOptional("package.json")) as {
	scripts?: Record<string, string | undefined>;
};

async function importWorker() {
	return (await import("../src/index")).default;
}

describe("public docs worker shell", () => {
	it("declares the app-api service binding, static asset binding, and staging route", () => {
		expect(wranglerConfig).toContain('name = "public-docs"');
		expect(wranglerConfig).toContain('main = "src/index.ts"');
		expect(wranglerConfig).toContain("workers_dev = false");
		expect(wranglerConfig).toContain("preview_urls = false");
		expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
		expect(wranglerConfig).toContain("[[services]]");
		expect(wranglerConfig).toContain('binding = "APP_API"');
		expect(wranglerConfig).toContain('service = "app-api"');
		expect(wranglerConfig).toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('pattern = "campus-docs-staging.ayafeed.com"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain("[[env.staging.services]]");
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain("[env.staging.vars]");
		expect(wranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerConfig).toContain('PUBLIC_DOCS_HOSTNAME = "campus-docs-staging.ayafeed.com"');
		expect(wranglerConfig).toContain("[assets]");
		expect(wranglerConfig).toContain('directory = "./doc_build"');
		expect(wranglerConfig).toContain('binding = "ASSETS"');
		expect(wranglerConfig).toContain('not_found_handling = "404-page"');
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("pnpm run build");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("dev-live-smoke.mjs");
		expect(wranglerLocalSmokeConfig).toContain('name = "public-docs"');
		expect(wranglerLocalSmokeConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerLocalSmokeConfig).toContain('PUBLIC_DOCS_HOSTNAME = "127.0.0.1:27114"');
		expect(wranglerLocalSmokeConfig).toContain("[secrets]");
		expect(wranglerLocalSmokeConfig).toContain("required = []");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
		expect(packageManifest.scripts?.["deploy:verify-config"]).toContain("verify-worker-config.mjs");
	});

	it("serves healthz and readyz from the worker shell", async () => {
		const worker = await importWorker();
		const env = {
			APP_API: {
				fetch: async () =>
					new Response(JSON.stringify({ status: "ready" }), {
						headers: { "content-type": "application/json" },
						status: 200,
					}),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_DOCS_APP_NAME: "campus-agent-public-docs",
			PUBLIC_DOCS_HOSTNAME: "docs.example.com",
		};

		const health = await worker.fetch(new Request("https://docs.example.com/healthz"), env);
		const ready = await worker.fetch(new Request("https://docs.example.com/readyz"), env);

		expect(health.status).toBe(200);
		expect(health.headers.get("cache-control")).toBe("no-store");
		await expect(health.json()).resolves.toEqual({
			status: "ok",
			app_name: "campus-agent-public-docs",
			surface: "public-docs",
			runtime: "cloudflare-worker",
		});

		expect(ready.status).toBe(200);
		expect(ready.headers.get("cache-control")).toBe("no-store");
		await expect(ready.json()).resolves.toEqual({
			status: "ready",
			app_api_base_url: "https://app-api.internal",
			dependencies: {
				appApiBinding: "configured",
				docsControlPlane: "ready",
				assets: "configured",
			},
			public_hostname: "docs.example.com",
			runtime: "cloudflare-worker",
		});
	});

	it("fails readyz closed when worker dependencies are missing", async () => {
		const worker = await importWorker();
		const response = await worker.fetch(new Request("https://docs.example.com/readyz"), {});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: [
						"APP_API binding",
						"ASSETS binding",
						"APP_API_BASE_URL",
						"PUBLIC_DOCS_HOSTNAME",
					],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("proxies only same-site docs control-plane requests to app-api", async () => {
		const worker = await importWorker();
		let forwardedAccept: string | null = null;
		let forwardedCookie: string | null = null;
		let forwardedTraceId: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request(
				"https://docs.example.com/api/docs/collections/curriculum/curriculum_plan/search?q=%E8%AF%BE%E7%A8%8B",
				{
					headers: {
						accept: "application/json",
						cookie: "better-auth.session_token=test",
						"if-none-match": '"nav-v1"',
						origin: "https://spoofed.example.com",
						"x-trace-id": "trace-docs-001",
					},
				},
			),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedAccept = request.headers.get("accept");
						forwardedCookie = request.headers.get("cookie");
						forwardedTraceId = request.headers.get("x-trace-id");
						forwardedUrl = request.url;

						return new Response(
							JSON.stringify({
								query: "课程",
								results: [],
							}),
							{
								headers: {
									"cache-control": "public, max-age=60",
									"content-type": "application/json; charset=utf-8",
								},
								status: 200,
							},
						);
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("should not hit assets", { status: 500 }),
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
			query: "课程",
			results: [],
		});
		expect(forwardedUrl).toBe(
			"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/search?q=%E8%AF%BE%E7%A8%8B",
		);
		expect(forwardedAccept).toBe("application/json");
		expect(forwardedCookie).toBe("better-auth.session_token=test");
		expect(forwardedTraceId).toBe("trace-docs-001");
	});

	it("does not expose public-docs as a generic app-api proxy", async () => {
		const worker = await importWorker();
		let appApiCalled = false;

		const response = await worker.fetch(new Request("https://docs.example.com/api/chat/requests"), {
			APP_API: {
				fetch: async () => {
					appApiCalled = true;
					return new Response("unexpected", { status: 200 });
				},
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("asset", { status: 200 }),
			},
			PUBLIC_DOCS_HOSTNAME: "docs.example.com",
		});

		expect(response.status).toBe(404);
		expect(appApiCalled).toBe(false);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	});

	it("serves static docs assets and marks html shell responses as no-store", async () => {
		const worker = await importWorker();
		const response = await worker.fetch(new Request("https://docs.example.com/docs"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () =>
					new Response("<!doctype html><html><body>docs</body></html>", {
						headers: {
							"cache-control": "public, max-age=3600",
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			PUBLIC_DOCS_HOSTNAME: "docs.example.com",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.text()).resolves.toContain("docs");
	});

	it("serves the gated reader fallback shell when a docs route misses static assets", async () => {
		const worker = await importWorker();
		const assetRequests: string[] = [];
		const response = await worker.fetch(
			new Request("https://docs.example.com/docs/curriculum/curriculum_plan/restricted-program"),
			{
				APP_API: {
					fetch: async () => new Response(null, { status: 204 }),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async (request: Request) => {
						assetRequests.push(new URL(request.url).pathname);
						if (new URL(request.url).pathname === "/reader-fallback.html") {
							return new Response("<!doctype html><html><body>reader fallback</body></html>", {
								headers: {
									"cache-control": "public, max-age=3600",
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							});
						}
						return new Response("missing", { status: 404 });
					},
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.text()).resolves.toContain("reader fallback");
		expect(assetRequests).toEqual([
			"/docs/curriculum/curriculum_plan/restricted-program",
			"/reader-fallback.html",
		]);
	});

	it("serves the reader fallback shell for gated scoped regulation docs routes", async () => {
		const worker = await importWorker();
		const documentSlug =
			"中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则";
		const encodedSlug = encodeURIComponent(documentSlug);
		const assetRequests: string[] = [];
		const response = await worker.fetch(
			new Request(`https://docs.example.com/docs/regulations/scoped_rules/${encodedSlug}`),
			{
				APP_API: {
					fetch: async () => new Response(null, { status: 204 }),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async (request: Request) => {
						assetRequests.push(new URL(request.url).pathname);
						if (new URL(request.url).pathname === "/reader-fallback.html") {
							return new Response("<!doctype html><html><body>reader fallback</body></html>", {
								headers: {
									"cache-control": "public, max-age=3600",
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							});
						}
						return new Response("missing", { status: 404 });
					},
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.text()).resolves.toContain("reader fallback");
		expect(assetRequests).toEqual([
			`/docs/regulations/scoped_rules/${encodedSlug}`,
			"/reader-fallback.html",
		]);
	});

	it("serves the gated collection fallback shell when a collection route misses static assets", async () => {
		const worker = await importWorker();
		const assetRequests: string[] = [];
		const response = await worker.fetch(
			new Request("https://docs.example.com/docs/regulations/scoped_rules/"),
			{
				APP_API: {
					fetch: async () => new Response(null, { status: 204 }),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async (request: Request) => {
						assetRequests.push(new URL(request.url).pathname);
						if (new URL(request.url).pathname === "/collection-fallback.html") {
							return new Response("<!doctype html><html><body>collection fallback</body></html>", {
								headers: {
									"cache-control": "public, max-age=3600",
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							});
						}
						if (new URL(request.url).pathname === "/reader-fallback.html") {
							return new Response("<!doctype html><html><body>reader fallback</body></html>", {
								headers: {
									"cache-control": "public, max-age=3600",
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							});
						}
						return new Response("missing", { status: 404 });
					},
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.text()).resolves.toContain("collection fallback");
		expect(assetRequests).toEqual(["/docs/regulations/scoped_rules/", "/collection-fallback.html"]);
	});

	it("serves gated static assets only after app-api admission check passes", async () => {
		const worker = await importWorker();
		let admissionUrl: string | null = null;
		let admissionCookie: string | null = null;
		let assetsCalled = false;
		const response = await worker.fetch(
			new Request(
				"https://docs.example.com/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
				{
					headers: {
						cookie: "better-auth.session_token=test",
					},
				},
			),
			{
				APP_API: {
					fetch: async (request: Request) => {
						admissionUrl = request.url;
						admissionCookie = request.headers.get("cookie");
						return new Response(null, { status: 204 });
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => {
						assetsCalled = true;
						return new Response('{"sections":[]}', {
							headers: {
								"cache-control": "public, max-age=3600",
								"content-type": "application/json; charset=utf-8",
							},
							status: 200,
						});
					},
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("vary")).toContain("Cookie");
		expect(response.headers.get("vary")).toContain("Authorization");
		await expect(response.text()).resolves.toBe('{"sections":[]}');
		expect(assetsCalled).toBe(true);
		expect(admissionUrl).toBe(
			"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/restricted-program/admission?version=2026-current",
		);
		expect(admissionCookie).toBe("better-auth.session_token=test");
	});

	it("serves scoped regulation gated assets behind app-api admission without leaking storage locators", async () => {
		const worker = await importWorker();
		const documentSlug =
			"中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则";
		const encodedSlug = encodeURIComponent(documentSlug);
		const gatedPath = `/_gated-docs/regulations/scoped_rules/${encodedSlug}/2026-current/reader.json`;
		let admittedUrl: string | null = null;
		let admittedCookie: string | null = null;
		let assetRequestPath: string | null = null;

		const authorized = await worker.fetch(
			new Request(`https://docs.example.com${gatedPath}`, {
				headers: {
					cookie: "better-auth.session_token=campus-member",
				},
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						admittedUrl = request.url;
						admittedCookie = request.headers.get("cookie");
						return new Response(null, { status: 204 });
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async (request: Request) => {
						assetRequestPath = new URL(request.url).pathname;
						return new Response(
							JSON.stringify({
								document: {
									title:
										"中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
								},
								sections: [],
							}),
							{
								headers: {
									"cache-control": "public, max-age=3600",
									"content-type": "application/json; charset=utf-8",
								},
								status: 200,
							},
						);
					},
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(authorized.status).toBe(200);
		expect(authorized.headers.get("cache-control")).toBe("no-store");
		expect(authorized.headers.get("vary")).toContain("Cookie");
		expect(authorized.headers.get("vary")).toContain("Authorization");
		const authorizedPayload = await authorized.text();
		expect(authorizedPayload).toContain("硕博连读研究生招生实施细则");
		expect(authorizedPayload).not.toContain("regulations/documents/");
		expect(authorizedPayload).not.toContain("reader-assets/");
		expect(authorizedPayload).not.toContain("portal");
		expect(assetRequestPath).toBe(gatedPath);
		expect(admittedUrl).toBe(
			`https://app-api.internal/api/docs/collections/regulations/scoped_rules/documents/${encodedSlug}/admission?version=2026-current`,
		);
		expect(admittedCookie).toBe("better-auth.session_token=campus-member");

		let deniedAssetCalled = false;
		const denied = await worker.fetch(new Request(`https://docs.example.com${gatedPath}`), {
			APP_API: {
				fetch: async () => new Response(null, { status: 404 }),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => {
					deniedAssetCalled = true;
					return new Response("unexpected", { status: 200 });
				},
			},
			PUBLIC_DOCS_HOSTNAME: "docs.example.com",
		});

		expect(denied.status).toBe(404);
		expect(denied.headers.get("cache-control")).toBe("no-store");
		expect(denied.headers.get("vary")).toContain("Cookie");
		expect(denied.headers.get("vary")).toContain("Authorization");
		expect(deniedAssetCalled).toBe(false);
	});

	it("fails closed for gated static assets when admission is denied", async () => {
		const worker = await importWorker();
		let assetsCalled = false;
		const response = await worker.fetch(
			new Request(
				"https://docs.example.com/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
			),
			{
				APP_API: {
					fetch: async () => new Response(null, { status: 404 }),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => {
						assetsCalled = true;
						return new Response("unexpected", { status: 200 });
					},
				},
				PUBLIC_DOCS_HOSTNAME: "docs.example.com",
			},
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("vary")).toContain("Cookie");
		expect(response.headers.get("vary")).toContain("Authorization");
		expect(assetsCalled).toBe(false);
	});
});
