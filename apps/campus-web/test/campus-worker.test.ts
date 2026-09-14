import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";

const appRoot = join(__dirname, "..");

function createEnv(appApi?: Env["APP_API"], assets?: Env["ASSETS"]): Env {
	return {
		...(appApi ? { APP_API: appApi } : {}),
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: assets ?? {
			fetch: () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html" },
				}),
		},
		STATUS_WEB_PUBLIC_ORIGIN: "https://status.muc.wiki",
	};
}

function readTextFixture(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("campus worker boundary", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("serves healthz without requiring app-api", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/healthz"),
			createEnv(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-campus-web",
			surface: "campus-web",
		});
	});

	it("redirects the status entry to the configured public origin", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/status?from=nav", {
				headers: { accept: "text/html" },
			}),
			createEnv(),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://status.muc.wiki/");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("fails closed when the status public origin is missing or malformed", async () => {
		for (const origin of [undefined, "https://status.muc.wiki/path", "javascript:alert(1)"]) {
			const env = createEnv();
			if (origin) {
				env.STATUS_WEB_PUBLIC_ORIGIN = origin;
			} else {
				delete env.STATUS_WEB_PUBLIC_ORIGIN;
			}
			const response = await worker.fetch(new Request("https://campus.muc.wiki/status"), env);
			expect(response.status).toBe(503);
			await expect(response.json()).resolves.toMatchObject({
				error: { details: { missing: ["STATUS_WEB_PUBLIC_ORIGIN"] } },
			});
		}
	});

	it("serves readyz without a runtime docs dependency", async () => {
		const env = createEnv({ fetch: () => new Response(null, { status: 200 }) });
		delete env.STATUS_WEB_PUBLIC_ORIGIN;

		const response = await worker.fetch(new Request("https://campus.muc.wiki/readyz"), env);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ status: "ready" });
	});

	it("serves the favicon through static assets before shell route matching", async () => {
		const assetFetch = vi.fn(() =>
			Promise.resolve(
				new Response(new Uint8Array([0, 0, 1, 0]), {
					headers: { "content-type": "image/x-icon" },
				}),
			),
		);

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/favicon.ico"),
			createEnv(undefined, { fetch: assetFetch }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/x-icon");
		expect(assetFetch).toHaveBeenCalledTimes(1);
	});

	it("serves the theme bootstrap through static assets before shell route matching", async () => {
		const assetFetch = vi.fn((request: Request) => {
			expect(new URL(request.url).pathname).toBe("/theme-bootstrap.js");
			return Promise.resolve(
				new Response("window.__theme_bootstrap__ = true;", {
					headers: { "content-type": "application/javascript" },
				}),
			);
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/theme-bootstrap.js"),
			createEnv(undefined, { fetch: assetFetch }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/javascript");
		expect(assetFetch).toHaveBeenCalledTimes(1);
	});

	it("allows only explicit app-api seams", async () => {
		const seen: string[] = [];
		const env = createEnv({
			fetch(request) {
				const pathname = new URL(request.url).pathname;
				seen.push(pathname);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const allowed = [
			"/api/me",
			"/api/me/profile-memory",
			"/api/me/profile-memory/items",
			"/api/me/profile-memory/items/item_1",
			"/api/me/profile-memory/settings",
			"/api/auth/sign-in/email",
			"/api/auth/sign-up/email",
			"/api/auth/sign-out",
			"/api/auth/get-session",
			"/api/auth/list-accounts",
			"/api/auth/list-sessions",
			"/api/auth/request-password-reset",
			"/api/auth/reset-password",
			"/api/federation/client",
			"/api/federation/authorize",
			"/api/federation/consent",
			"/api/federation/token",
			"/api/federation/userinfo",
			"/api/federation/jwks",
			"/api/federation/logout",
			"/api/chat/conversations",
			"/api/chat/conversations/search",
			"/api/chat/conversations/conv_1",
			"/api/chat/conversations/conv_1/archive",
			"/api/chat/conversations/conv_1/pin",
			"/api/chat/conversations/conv_1/messages/msg_1/feedback",
			"/api/chat/conversations/conv_1/messages/msg_1/trailing",
			"/api/chat/requests",
			"/api/chat/requests/stream",
			"/api/chat/requests/req_1",
			"/api/chat/requests/req_1/events",
			"/api/chat/requests/req_1/events/stream",
			"/api/chat/requests/req_1/steps",
			"/api/chat/requests/req_1/cancel",
			"/api/dining",
			`/api/dining/floorplans/${"a".repeat(64)}.svg`,
			"/api/feedback",
		];

		for (const path of allowed) {
			const response = await worker.fetch(new Request(`https://campus.muc.wiki${path}`), env);
			expect(response.status).toBe(200);
		}

		const rejected = await worker.fetch(new Request("https://campus.muc.wiki/api/ops/dining"), env);
		expect(rejected.status).toBe(404);
		const rejectedIdentity = await worker.fetch(
			new Request("https://campus.muc.wiki/api/me/identity"),
			env,
		);
		expect(rejectedIdentity.status).toBe(404);
		const rejectedDocsSearch = await worker.fetch(
			new Request("https://campus.muc.wiki/api/docs/collections/regulations/student_rules/search"),
			env,
		);
		expect(rejectedDocsSearch.status).toBe(404);
		expect(seen).toEqual(allowed);
	});

	it("serves registered browser routes through the shell", async () => {
		const seenAssetPaths: string[] = [];
		const env = createEnv(undefined, {
			fetch(request) {
				seenAssetPaths.push(new URL(request.url).pathname);
				return new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html" },
				});
			},
		});
		const routes = [
			"/",
			"/c/conv_1",
			"/map",
			"/transport",
			"/dining",
			"/groups",
			"/feedback",
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-link-sent",
			"/account/reset-password",
			"/account/reset-complete",
			"/account/verify-email",
			"/account/verify-email/result",
			"/account/change-password",
			"/account/settings/account",
			"/account/settings/security",
			"/account/settings/memory",
			"/account/federation/consent",
			"/account/federation/error",
			"/legal/terms",
			"/legal/privacy",
		];
		for (const path of routes) {
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki${path}`, {
					headers: { accept: "text/html" },
				}),
				env,
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
		}
		expect(seenAssetPaths).toEqual(routes.map(() => "/index.html"));
	});

	it("serves content-addressed campus map assets from Cloudflare Assets", async () => {
		const geojsonDigest = "a".repeat(64);
		const placesDigest = "b".repeat(64);
		const assetFetch = vi.fn((request: Request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/campus-map/manifest.json") {
				return new Response("{}", { headers: { "content-type": "application/json" } });
			}
			if (pathname.endsWith(`${geojsonDigest}.geojson`)) {
				return new Response('{"type":"FeatureCollection","features":[]}', {
					headers: { "content-type": "application/geo+json" },
				});
			}
			if (pathname.endsWith(`${placesDigest}.json`)) {
				return new Response('{"campus":{},"places":[]}', {
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(null, { status: 404 });
		});
		const env = createEnv(undefined, { fetch: assetFetch });

		const manifest = await worker.fetch(
			new Request("https://campus.muc.wiki/campus-map/manifest.json"),
			env,
		);
		const asset = await worker.fetch(
			new Request(`https://campus.muc.wiki/campus-map/assets/${geojsonDigest}.geojson`),
			env,
		);
		const placesHead = await worker.fetch(
			new Request(`https://campus.muc.wiki/campus-map/places/${placesDigest}.json`, {
				method: "HEAD",
			}),
			env,
		);

		expect(manifest.status).toBe(200);
		expect(manifest.headers.get("cache-control")).toContain("max-age=60");
		expect(asset.status).toBe(200);
		expect(asset.headers.get("cache-control")).toContain("immutable");
		expect(asset.headers.get("content-type")).toContain("application/geo+json");
		expect(placesHead.status).toBe(200);
		expect(await placesHead.text()).toBe("");
	});

	it("does not cache missing campus map assets", async () => {
		const assetFetch = vi.fn(() => new Response("missing", { status: 404 }));
		const response = await worker.fetch(
			new Request(`https://campus.muc.wiki/campus-map/assets/${"c".repeat(64)}.geojson`),
			createEnv(undefined, { fetch: assetFetch }),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).not.toContain("application/geo+json");
	});

	it("rejects encoded and traversal campus map paths before Cloudflare Assets", async () => {
		const assetFetch = vi.fn(() => new Response("unexpected static request"));
		const env = createEnv(undefined, { fetch: assetFetch });

		for (const url of [
			"https://campus.muc.wiki/campus-map/manifest%2Ejson",
			"https://campus.muc.wiki/campus-map/assets/%2e%2e/manifest.json",
			"https://campus.muc.wiki/campus-map/assets/../README.md",
		]) {
			const response = await worker.fetch(
				{ headers: new Headers(), method: "GET", url } as Request,
				env,
			);
			expect(response.status).toBe(404);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}

		expect(assetFetch).not.toHaveBeenCalled();
	});

	it("leaves public docs delivery to Cloudflare Assets", async () => {
		const assetFetch = vi.fn(() => new Response("unexpected static request"));
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/docs/regulations/student_rules/test-document"),
			createEnv(undefined, { fetch: assetFetch }),
		);

		expect(response.status).toBe(404);
		expect(assetFetch).not.toHaveBeenCalled();
	});

	it("keeps the Q&A shell CSP first-party for assistant chat", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/", {
				headers: { accept: "text/html" },
			}),
			createEnv(),
		);

		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
		expect(csp).not.toContain("static.cloudflareinsights.com");
		expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
		expect(csp).not.toContain("cloudflareinsights.com");
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("img-src 'self' https://p.qlogo.cn data: blob:");
		expect(csp).not.toContain("https://cdn.platform.openai.com");
	});

	it("does not treat Vite dev module requests as campus shell HTML", async () => {
		const seenAssetPaths: string[] = [];
		const env = createEnv(undefined, {
			fetch(request) {
				seenAssetPaths.push(new URL(request.url).pathname);
				return new Response('<!doctype html><div id="root">vite overlay</div></body>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 500,
				});
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/src/components/ui/toggle.tsx", {
				headers: { accept: "*/*" },
			}),
			env,
		);

		expect(response.status).toBe(500);
		expect(seenAssetPaths).toEqual(["/src/components/ui/toggle.tsx"]);
		await expect(response.text()).resolves.not.toContain("__CAMPUS_RUNTIME_CONFIG__");
	});

	it("forwards browser trace context headers into canonical app-api chat streams", async () => {
		const forwardedRequests: Request[] = [];
		const env = createEnv({
			fetch(request) {
				forwardedRequests.push(request);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/chat/requests/stream", {
				body: JSON.stringify({ prompt: "国家奖学金什么时候评审？" }),
				headers: {
					baggage: "app.component=campus-web",
					"content-type": "application/json",
					traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
					"x-trace-id": "trace_01HQ",
				},
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		expect(forwardedRequests).toHaveLength(1);
		const [forwarded] = forwardedRequests;
		if (!forwarded) {
			throw new Error("expected one forwarded request");
		}
		expect(forwarded.headers.get("traceparent")).toBe(
			"00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
		);
		expect(forwarded.headers.get("baggage")).toBe("app.component=campus-web");
		expect(forwarded.headers.get("x-trace-id")).toBeNull();
	});

	it("forwards sign-up legal consent only on auth requests", async () => {
		const forwardedRequests: Request[] = [];
		const env = createEnv({
			fetch(request) {
				forwardedRequests.push(request);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/auth/sign-up/email", {
				body: JSON.stringify({ email: "student@example.edu" }),
				headers: {
					"content-type": "application/json",
					"x-campus-legal-accepted": "terms-and-privacy",
				},
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		expect(forwardedRequests).toHaveLength(1);
		expect(forwardedRequests[0]?.headers.get("x-campus-legal-accepted")).toBe("terms-and-privacy");
	});

	it("forwards browser interaction headers for federation consent", async () => {
		const forwardedRequests: Request[] = [];
		const env = createEnv({
			fetch(request) {
				forwardedRequests.push(request);
				return Response.json({ redirect: true, url: "https://oauth.example.test/callback" });
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/federation/consent", {
				body: JSON.stringify({ accept: true, oauth_query: "signed-query" }),
				headers: {
					cookie: "better-auth.session_token=session-token",
					"content-type": "application/json",
					origin: "https://campus.muc.wiki",
					referer: "https://campus.muc.wiki/account/federation/consent",
					"user-agent": "campus-worker-test",
				},
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const forwarded = forwardedRequests[0];
		expect(forwarded?.headers.get("cookie")).toBe("better-auth.session_token=session-token");
		expect(forwarded?.headers.get("content-type")).toBe("application/json");
		expect(forwarded?.headers.get("origin")).toBe("https://campus.muc.wiki");
		expect(forwarded?.headers.get("referer")).toBe(
			"https://campus.muc.wiki/account/federation/consent",
		);
		expect(forwarded?.headers.get("user-agent")).toBe("campus-worker-test");
	});

	it("uses the configured loopback app-api URL as local dev proxy transport", async () => {
		const appApiBinding = {
			fetch() {
				throw new Error("service binding should not be used for local loopback proxy");
			},
		};
		const env = {
			...createEnv(appApiBinding),
			APP_API_BASE_URL: "http://127.0.0.1:27031",
		};
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: { code: "session_required", message: "请先登录。" },
				}),
				{ headers: { "content-type": "application/json" }, status: 401 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			new Request("http://127.0.0.1:27014/api/chat/requests/stream", {
				body: JSON.stringify({ prompt: "国家奖学金什么时候评审？" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(401);
		expect(fetchMock).toHaveBeenCalledOnce();
		const firstCall = fetchMock.mock.calls[0];
		if (!firstCall) {
			throw new Error("expected one forwarded fetch call");
		}
		const forwarded = firstCall[0] as Request;
		expect(forwarded.url).toBe("http://127.0.0.1:27031/api/chat/requests/stream");
		expect(forwarded.headers.get("content-type")).toBe("application/json");
		await expect(forwarded.text()).resolves.toBe(
			JSON.stringify({ prompt: "国家奖学金什么时候评审？" }),
		);
		await expect(response.text()).resolves.toContain("请先登录。");
	});

	it("forwards the public transport schedule query to the configured app-api", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ date: "2026-09-08", routes: [] }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const env = { ...createEnv(), APP_API_BASE_URL: "http://127.0.0.1:27031" };

		const response = await worker.fetch(
			new Request("http://127.0.0.1:27014/api/transport/schedule?date=2026-09-08"),
			env,
		);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const firstCall = fetchMock.mock.calls[0];
		if (!firstCall) {
			throw new Error("expected one forwarded fetch call");
		}
		expect((firstCall[0] as Request).url).toBe(
			"http://127.0.0.1:27031/api/transport/schedule?date=2026-09-08",
		);
		await expect(response.json()).resolves.toEqual({ date: "2026-09-08", routes: [] });
	});

	it("strips stale entity encoding headers from proxied app-api responses", async () => {
		const env = createEnv({
			fetch() {
				return new Response(
					JSON.stringify({
						error: { code: "session_required", message: "请先登录。" },
					}),
					{
						headers: {
							"content-encoding": "gzip",
							"content-length": "9999",
							"content-type": "application/json",
						},
						status: 401,
					},
				);
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/chat/requests/stream", {
				body: JSON.stringify({ prompt: "国家奖学金什么时候评审？" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("content-encoding")).toBeNull();
		expect(response.headers.get("content-length")).toBeNull();
		await expect(response.text()).resolves.toContain("请先登录。");
	});

	it("forwards non-streaming app-api bodies without materializing them at the edge", async () => {
		const upstream = new Response(JSON.stringify({ ok: true }), {
			headers: { "content-type": "application/json" },
		});
		const env = createEnv({
			fetch() {
				return upstream;
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/me/profile-memory"),
			env,
		);

		expect(upstream.bodyUsed).toBe(false);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("does not expose upstream HTML error overlays through app-api proxy routes", async () => {
		const env = createEnv({
			fetch() {
				return new Response("<!doctype html><title>Error</title><body>fetch failed</body>", {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 500,
				});
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/auth/sign-in/email", {
				body: JSON.stringify({ email: "wrong@example.edu", password: "wrongpassword123" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "服务暂不可用，请稍后再试。",
				retryable: true,
				requestId: null,
				details: null,
			},
		});
	});

	it("does not expose Pagefind as a public docs search asset path", async () => {
		let assetsCalled = false;
		const env = createEnv();
		env.ASSETS = {
			fetch: () => {
				assetsCalled = true;
				return new Response("unexpected", { status: 200 });
			},
		};

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/pagefind/pagefind.js"),
			env,
		);

		expect(response.status).toBe(404);
		expect(assetsCalled).toBe(false);
	});

	it("leaves public docs and reader assets to Cloudflare Assets", () => {
		const wranglerConfig = readTextFixture("wrangler.toml");

		expect(wranglerConfig).toContain(
			'run_worker_first = [ "/*", "!/assets/*", "!/vendor/*", "!/docs", "!/docs/*", "!/_docs/*", "!/@fs/*", "!/@id/*", "!/@react-refresh*", "!/@vite/*", "!/node_modules/*", "!/src/*" ]',
		);
		expect(wranglerConfig).toContain('html_handling = "drop-trailing-slash"');
		expect(wranglerConfig).toContain('not_found_handling = "404-page"');
		expect(wranglerConfig).not.toContain("_docs-static");
		expect(wranglerConfig).not.toContain("!/map-assets/*");
		expect(wranglerConfig).not.toContain("!/static/*");
		expect(wranglerConfig).not.toContain("!/_gated-docs/*");
		expect(wranglerConfig).not.toContain("!/_gated-docs-search/*");
	});

	it("keeps retired docs APIs and private asset namespaces closed", async () => {
		const appApiFetch = vi.fn(() => new Response(null, { status: 200 }));
		const assetFetch = vi.fn(() => new Response("unexpected", { status: 200 }));
		const env = createEnv({ fetch: appApiFetch }, { fetch: assetFetch });

		for (const path of [
			"/api/docs/readyz",
			"/api/docs/collections/regulations/student_rules/navigation",
			"/_gated-docs/regulations/student_rules/old/reader.json",
			"/_gated-docs-search/regulations/student_rules/old/index.json",
		]) {
			const response = await worker.fetch(new Request(`https://campus.muc.wiki${path}`), env);
			expect(response.status).toBe(404);
		}
		expect(appApiFetch).not.toHaveBeenCalled();
		expect(assetFetch).not.toHaveBeenCalled();
	});

	it("injects public runtime config from worker env into the shell", async () => {
		const env = createEnv();
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/", {
				headers: { accept: "text/html" },
			}),
			env,
		);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("__CAMPUS_RUNTIME_CONFIG__");
		expect(html).toContain("__CAMPUS_AUTH_CONFIG__");
		expect(html).toContain("https://campus.muc.wiki/account");
		expect(html).toContain("https://campus.muc.wiki/account/login");
		expect(html).not.toContain("loginReturnApp");
	});
});
