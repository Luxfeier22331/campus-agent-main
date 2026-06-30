import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";

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
		CAMPUS_WEB_HOSTNAME: "campus.muc.wiki",
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

	it("allows only explicit app-api seams", async () => {
		const seen: string[] = [];
		const env = createEnv({
			fetch(request) {
				seen.push(new URL(request.url).pathname);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const allowed = [
			"/api/me",
			"/api/me/overview",
			"/api/me/identity",
			"/api/me/access",
			"/api/me/preferences",
			"/api/me/security/sessions",
			"/api/me/security/sessions/session_2",
			"/api/me/authorized-apps",
			"/api/me/authorized-apps/muc-wiki",
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
			"/api/docs/collections/regulations/student_rules/navigation",
			"/api/docs/collections/regulations/student_rules/documents/index/resolve",
			"/api/docs/collections/regulations/student_rules/documents/index/admission",
			"/api/campus-services/transport-schedule/status",
			"/api/campus-map/places",
			"/api/campus-map/places/library",
			"/api/dining/halls",
			"/api/dining/halls/haidian-canteen-1/floors/1f",
			"/api/dining/halls/haidian-canteen-1/reviews",
			"/api/feedback",
		];

		for (const path of allowed) {
			const response = await worker.fetch(new Request(`https://campus.muc.wiki${path}`), env);
			expect(response.status).toBe(200);
		}

		const rejected = await worker.fetch(new Request("https://campus.muc.wiki/api/ops/dining"), env);
		expect(rejected.status).toBe(404);
		const rejectedDocsSearch = await worker.fetch(
			new Request("https://campus.muc.wiki/api/docs/collections/regulations/student_rules/search"),
			env,
		);
		expect(rejectedDocsSearch.status).toBe(404);
		expect(seen).toEqual(allowed);
	});

	it("serves registered browser routes through the shell", async () => {
		const env = createEnv();
		for (const path of [
			"/",
			"/c/conv_1",
			"/map",
			"/dining",
			"/services",
			"/feedback",
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-password",
			"/account/sign-out",
			"/account/settings/account",
			"/account/settings/security",
			"/account/federation/consent",
			"/account/federation/error",
			"/legal/terms",
			"/legal/privacy",
		]) {
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki${path}`, {
					headers: { accept: "text/html" },
				}),
				env,
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
		}
	});

	it("serves materialized Rspress reader pages under /docs clean URLs", async () => {
		const seenAssetPaths: string[] = [];
		const env = createEnv(undefined, {
			fetch: (request) => {
				const pathname = new URL(request.url).pathname;
				seenAssetPaths.push(pathname);
				if (
					pathname === "/docs/regulations/student_rules/doc-a1b2c3d4e5f6.html" ||
					pathname === "/docs/regulations/student_rules/doc-a1b2c3d4e5f6/v/2018-current.html"
				) {
					return new Response(
						'<!doctype html><html><body><div id="__rspress_root">Rspress canonical reader</div></body></html>',
						{ headers: { "content-type": "text/html; charset=utf-8" } },
					);
				}
				return new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 404,
				});
			},
		});

		for (const path of [
			"/docs/regulations/student_rules/doc-a1b2c3d4e5f6",
			"/docs/regulations/student_rules/doc-a1b2c3d4e5f6/v/2018-current",
		]) {
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki${path}`, {
					headers: { accept: "text/html" },
				}),
				env,
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			await expect(response.text()).resolves.toContain("__rspress_root");
		}

		expect(seenAssetPaths).toEqual([
			"/docs/regulations/student_rules/doc-a1b2c3d4e5f6.html",
			"/docs/regulations/student_rules/doc-a1b2c3d4e5f6/v/2018-current.html",
		]);
	});

	it("redirects docs directory routes to the canonical reader entry after index pages are retired", async () => {
		const seenAssetPaths: string[] = [];
		const env = createEnv(undefined, {
			fetch: (request) => {
				seenAssetPaths.push(new URL(request.url).pathname);
				return new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 404,
				});
			},
		});

		for (const path of [
			"/docs",
			"/docs/",
			"/docs/regulations",
			"/docs/regulations/",
			"/docs/regulations/student_rules",
			"/docs/regulations/student_rules/",
		]) {
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki${path}`, {
					headers: { accept: "text/html" },
				}),
				env,
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(
				"https://campus.muc.wiki/docs/regulations/student_rules/doc-c62077b20430",
			);
			await expect(response.text()).resolves.toBe("");
		}

		expect(seenAssetPaths).toEqual([]);
	});

	it("does not rely on decoded non-ASCII docs filenames for clean URL delivery", async () => {
		const seenAssetPaths: string[] = [];
		const env = createEnv(undefined, {
			fetch: (request) => {
				seenAssetPaths.push(new URL(request.url).pathname);
				return new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 404,
				});
			},
		});

		const response = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/docs/regulations/student_rules/%E4%B8%AD%E5%A4%AE%E6%B0%91%E6%97%8F%E5%A4%A7%E5%AD%A6%E5%AD%A6%E7%94%9F%E7%AE%A1%E7%90%86%E8%A7%84%E5%AE%9A",
				{
					headers: { accept: "text/html" },
				},
			),
			env,
		);

		expect(response.status).toBe(404);
		expect(seenAssetPaths).toEqual([
			"/docs/regulations/student_rules/%E4%B8%AD%E5%A4%AE%E6%B0%91%E6%97%8F%E5%A4%A7%E5%AD%A6%E5%AD%A6%E7%94%9F%E7%AE%A1%E7%90%86%E8%A7%84%E5%AE%9A.html",
			"/docs/regulations/student_rules/%E4%B8%AD%E5%A4%AE%E6%B0%91%E6%97%8F%E5%A4%A7%E5%AD%A6%E5%AD%A6%E7%94%9F%E7%AE%A1%E7%90%86%E8%A7%84%E5%AE%9A/index.html",
		]);
	});

	it("fails closed for missing docs clean URLs instead of falling back to the React shell", async () => {
		const env = createEnv(undefined, {
			fetch: () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 404,
				}),
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/docs/regulations/student_rules/missing-doc", {
				headers: { accept: "text/html" },
			}),
			env,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.text()).resolves.not.toContain('id="root"');
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
			new Request("https://campus.muc.wiki/src/components/ui/separator.tsx", {
				headers: { accept: "*/*" },
			}),
			env,
		);

		expect(response.status).toBe(500);
		expect(seenAssetPaths).toEqual(["/src/components/ui/separator.tsx"]);
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
				body: JSON.stringify({ email: "student@muc.edu.cn" }),
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
				body: JSON.stringify({ email: "wrong@muc.edu.cn", password: "wrongpassword123" }),
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

	it("serves static Rspress runtime assets under the docs-owned static namespace", async () => {
		const env = createEnv();
		env.ASSETS = {
			fetch: (request) => {
				const pathname = new URL(request.url).pathname;
				return new Response(
					pathname.startsWith("/_docs-static/")
						? "console.log('Rspress runtime')"
						: '<!doctype html><div id="root"></div>',
					{ headers: { "content-type": "application/javascript" } },
				);
			},
		};

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/_docs-static/js/index.js"),
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toContain("Rspress runtime");
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

	it("keeps static Rspress and vendor assets outside the worker-first route gate", () => {
		const wranglerConfig = readTextFixture("wrangler.toml");

		expect(wranglerConfig).toContain(
			'run_worker_first = [ "/*", "!/assets/*", "!/vendor/*", "!/_docs-static/*", "!/_docs/*", "!/map-assets/*", "!/@fs/*", "!/@id/*", "!/@react-refresh*", "!/@vite/*", "!/node_modules/*", "!/src/*" ]',
		);
		expect(wranglerConfig).not.toContain("!/static/*");
		expect(wranglerConfig).not.toContain("!/_gated-docs/*");
		expect(wranglerConfig).not.toContain("!/_gated-docs-search/*");
	});

	it("serves gated reader assets only after app-api admission passes", async () => {
		let admissionUrl: string | null = null;
		let admissionCookie: string | null = null;
		let assetPath: string | null = null;
		const env = createEnv({
			fetch(request) {
				admissionUrl = request.url;
				admissionCookie = request.headers.get("cookie");
				return new Response(null, { status: 204 });
			},
		});
		env.ASSETS = {
			fetch(request) {
				assetPath = new URL(request.url).pathname;
				return new Response('{"sections":[]}', {
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			},
		};

		const response = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
				{
					headers: {
						cookie: "better-auth.session_token=test",
					},
				},
			),
			env,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("vary")).toContain("Cookie");
		expect(response.headers.get("vary")).toContain("Authorization");
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.text()).resolves.toBe('{"sections":[]}');
		expect(assetPath).toBe(
			"/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
		);
		expect(admissionUrl).toBe(
			"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/restricted-program/admission?version=2026-current",
		);
		expect(admissionCookie).toBe("better-auth.session_token=test");
	});

	it("fails closed for gated reader assets when admission is denied", async () => {
		let assetsCalled = false;
		const env = createEnv({
			fetch() {
				return new Response(null, { status: 404 });
			},
		});
		env.ASSETS = {
			fetch() {
				assetsCalled = true;
				return new Response("unexpected", { status: 200 });
			},
		};

		const response = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
			),
			env,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("vary")).toContain("Cookie");
		expect(response.headers.get("vary")).toContain("Authorization");
		expect(assetsCalled).toBe(false);
	});

	it("serves protected docs search indexes only after app-api admission passes", async () => {
		let admissionUrl: string | null = null;
		let assetPath: string | null = null;
		const env = createEnv({
			fetch(request) {
				admissionUrl = request.url;
				return new Response(null, { status: 204 });
			},
		});
		env.ASSETS = {
			fetch(request) {
				assetPath = new URL(request.url).pathname;
				return new Response(
					'{"schemaVersion":"campus_docs_protected_search_index_v1","visibilityMode":"principal_protected_static","entries":[]}',
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			},
		};

		const response = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/_gated-docs-search/curriculum/curriculum_plan/restricted-program/2026-current/index.json",
				{ headers: { cookie: "better-auth.session_token=test" } },
			),
			env,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("vary")).toContain("Cookie");
		expect(response.headers.get("vary")).toContain("Authorization");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(assetPath).toBe(
			"/_gated-docs-search/curriculum/curriculum_plan/restricted-program/2026-current/index.json",
		);
		expect(admissionUrl).toBe(
			"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/restricted-program/admission?version=2026-current",
		);
	});

	it("fails closed with JSON when protected docs search index static asset is missing", async () => {
		const env = createEnv({
			fetch() {
				return new Response(null, { status: 204 });
			},
		});
		env.ASSETS = {
			fetch() {
				return new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 404,
				});
			},
		};

		const response = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/_gated-docs-search/curriculum/curriculum_plan/restricted-program/2026-current/index.json",
				{ headers: { cookie: "better-auth.session_token=test" } },
			),
			env,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.text()).resolves.not.toContain("<!doctype html>");
	});

	it("fails closed for protected docs search indexes when admission is denied", async () => {
		let assetsCalled = false;
		const env = createEnv({
			fetch() {
				return new Response(null, { status: 404 });
			},
		});
		env.ASSETS = {
			fetch() {
				assetsCalled = true;
				return new Response("unexpected", { status: 200 });
			},
		};

		const response = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/_gated-docs-search/curriculum/curriculum_plan/restricted-program/2026-current/index.json",
			),
			env,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("vary")).toContain("Cookie");
		expect(response.headers.get("vary")).toContain("Authorization");
		expect(assetsCalled).toBe(false);
	});

	it("injects public runtime config from worker env into the shell", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/", {
				headers: { accept: "text/html" },
			}),
			createEnv(),
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
