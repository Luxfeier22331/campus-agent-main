import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { applyUpstreamCorrelationTags, type Env } from "../src/index";

const appRoot = join(__dirname, "..");

function createEnv(appApi?: Env["APP_API"], assets?: Env["ASSETS"]): Env {
	return {
		APP_API: appApi,
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: assets ?? {
			fetch: () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html" },
				}),
		},
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

	it("serves readyz without a runtime docs dependency", async () => {
		const env = createEnv({ fetch: () => new Response(null, { status: 200 }) });

		const response = await worker.fetch(new Request("https://campus.muc.wiki/readyz"), env);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ status: "ready" });
	});

	it("adds validated upstream product correlation IDs to the current Sentry scope", () => {
		const setTag = vi.fn();
		applyUpstreamCorrelationTags(
			new Response(null, {
				headers: {
					"x-request-id": "req_01HQ",
					"x-trace-id": "trace_01HQ",
				},
			}),
			setTag,
		);
		expect(setTag).toHaveBeenCalledWith("campus.request_id", "req_01HQ");
		expect(setTag).toHaveBeenCalledWith("campus.trace_id", "trace_01HQ");

		setTag.mockClear();
		applyUpstreamCorrelationTags(
			new Response(null, { headers: { "x-request-id": "invalid value" } }),
			setTag,
		);
		expect(setTag).not.toHaveBeenCalled();
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
			"/api/federation/authorize",
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
			"/api/chat/runs/run_1",
			"/api/chat/runs/run_1/events",
			"/api/chat/runs/run_1/events/stream",
			"/api/chat/runs/run_1/cancel",
			"/api/campus-map/manifest",
			`/api/campus-map/assets/${"a".repeat(64)}.geojson`,
			"/api/campus-map/places",
			"/api/campus-map/places/library",
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
			"/dining",
			"/groups",
			"/feedback",
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-password",
			"/account/sign-out",
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
		expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
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
					baggage: "sentry-environment=staging",
					"content-type": "application/json",
					"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
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
		expect(forwarded.headers.get("traceparent")).toBe(
			"00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
		);
		expect(forwarded.headers.get("sentry-trace")).toBe(
			"0123456789abcdef0123456789abcdef-0123456789abcdef-1",
		);
		expect(forwarded.headers.get("baggage")).toBe("sentry-environment=staging");
		expect(forwarded.headers.get("x-trace-id")).toBe("trace_01HQ");
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
		const forwarded = fetchMock.mock.calls[0][0] as Request;
		expect(forwarded.url).toBe("http://127.0.0.1:27031/api/chat/requests/stream");
		expect(forwarded.headers.get("content-type")).toBe("application/json");
		await expect(forwarded.text()).resolves.toBe(
			JSON.stringify({ prompt: "国家奖学金什么时候评审？" }),
		);
		await expect(response.text()).resolves.toContain("请先登录。");
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
		const env = {
			...createEnv(),
			SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
			DEPLOYMENT_ENVIRONMENT: "staging",
			DEPLOYMENT_RELEASE: "campus-web@0123456789abcdef0123456789abcdef01234567",
		};
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
		expect(html).toContain("https://public@example.ingest.sentry.io/1");
		expect(html).toContain("campus-web@0123456789abcdef0123456789abcdef01234567");
		expect(html).not.toContain("loginReturnApp");
	});
});
