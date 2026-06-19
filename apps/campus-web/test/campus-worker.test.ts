import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
			"/api/auth/request-password-reset",
			"/api/auth/reset-password",
			"/api/federation/authorize",
			"/api/federation/token",
			"/api/federation/userinfo",
			"/api/federation/jwks",
			"/api/federation/logout",
			"/api/chat/conversations",
			"/api/chat/conversations/search",
			"/api/chatkit",
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
			"/api/campus-map/places",
			"/api/campus-map/places/library",
			"/api/dining/halls",
			"/api/dining/halls/haidian-canteen-1/floors/1f",
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
			"/docs/student_rules",
			"/map",
			"/dining",
			"/feedback",
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-password",
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

	it("allows the self-hosted ChatKit runtime required by the Q&A shell CSP", async () => {
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

	it("serves self-hosted ChatKit vendor assets through the static asset binding", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/vendor/openai-chatkit/2026-06-17/chatkit.js", {
				headers: { accept: "application/javascript" },
			}),
			createEnv(undefined, {
				fetch(request) {
					return new Response(`asset:${new URL(request.url).pathname}`, {
						headers: { "content-type": "application/javascript" },
					});
				},
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe(
			"asset:/vendor/openai-chatkit/2026-06-17/chatkit.js",
		);
	});

	it("returns product JSON when the ChatKit proxy dependency is unavailable", async () => {
		const env = createEnv({
			fetch() {
				throw new Error("fetch failed");
			},
		});

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/chatkit", {
				body: JSON.stringify({ type: "threads.create" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.text()).resolves.toContain("服务暂不可用，请稍后再试。");
	});

	it("forwards browser trace context headers into app-api chat requests", async () => {
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
			new Request("https://campus.muc.wiki/api/chatkit", {
				body: JSON.stringify({ type: "threads.create" }),
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
			new Request("http://127.0.0.1:27014/api/chatkit", {
				body: JSON.stringify({ type: "threads.list" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(401);
		expect(fetchMock).toHaveBeenCalledOnce();
		const forwarded = fetchMock.mock.calls[0][0] as Request;
		expect(forwarded.url).toBe("http://127.0.0.1:27031/api/chatkit");
		expect(forwarded.headers.get("content-type")).toBe("application/json");
		await expect(forwarded.text()).resolves.toBe(JSON.stringify({ type: "threads.list" }));
		await expect(response.text()).resolves.toContain("请先登录。");
	});

	it("serves Rspress-built docs assets under the campus docs route", async () => {
		const env = createEnv();
		env.ASSETS = {
			fetch: (request) => {
				const pathname = new URL(request.url).pathname;
				return new Response(
					pathname.startsWith("/docs/")
						? "<!doctype html><main>Rspress canonical reader</main>"
						: '<!doctype html><div id="root"></div>',
					{ headers: { "content-type": "text/html" } },
				);
			},
		};

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/docs/regulations/student_rules/sample", {
				headers: { accept: "text/html" },
			}),
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toContain("Rspress canonical reader");
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
			'run_worker_first = [ "/*", "!/assets/*", "!/vendor/*", "!/_docs-static/*", "!/_docs/*", "!/map-assets/*" ]',
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
