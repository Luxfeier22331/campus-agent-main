import { describe, expect, it } from "vitest";
import stagingPreflightSource from "../../../scripts/run-worker-staging-preflight.mjs?raw";
import packageManifestRaw from "../package.json?raw";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import worker, { type Env } from "../src/index";
import workerSource from "../src/index.ts?raw";
import viteConfigSource from "../vite.config.ts?raw";
import liveSmokeWranglerConfig from "../wrangler.local-smoke.toml?raw";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};

function createEnv(appApi?: Env["APP_API"]): Env {
	return {
		APP_API: appApi,
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: {
			fetch: () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html" },
				}),
		},
		HUB_WEB_HOSTNAME: "hub.muc.wiki",
	};
}

describe("hub worker boundary", () => {
	it("declares staging domain, app-api binding, deploy gates, and runtime-only Turnstile vars", () => {
		expect(packageManifest.scripts?.["build:staging"]).toContain("run-worker-staging-build.mjs");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toContain(
			"run-worker-staging-preflight.mjs",
		);
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toContain(
			"check_worker_secret_presence.py",
		);
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"verify-staging-config.mjs",
		);
		expect(packageManifest.scripts?.["build:staging"]).not.toContain("SENTRY_DSN");
		expect(wranglerConfig).toContain('pattern = "hub-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain('APP_API_BASE_URL = "http://127.0.0.1:27031"');
		expect(wranglerConfig).toContain('HUB_WEB_HOSTNAME = "127.0.0.1:27012"');
		expect(wranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerConfig).toContain('HUB_WEB_HOSTNAME = "hub-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(wranglerConfig).not.toContain('[env.staging.secrets]\nrequired = ["SENTRY_DSN"]');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).toContain("STAGING_HUB_AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).toContain("hub-staging.mucwiki-edge.link");
		expect(deployStagingSource).toContain('"pnpm"');
		expect(deployStagingSource).toContain('"exec"');
		expect(deployStagingSource).toContain('"wrangler"');
		expect(verifyStagingConfigSource).toContain("STAGING_HUB_AUTH_TURNSTILE_SITE_KEY");
		expect(verifyStagingConfigSource).toContain("custom_domain === true");
		expect(packageManifest.scripts?.dev).toContain("--port 27012");
		expect(stagingPreflightSource).toContain('"apps/hub-web"');
		expect(stagingPreflightSource).toContain("worker-staging-hub-web");
	});

	it("declares a canonical live-smoke path with app-api as an auxiliary worker", () => {
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("HUB_LIVE_SMOKE=1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--host 127.0.0.1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--port 27012");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--strictPort");
		expect(viteConfigSource).toContain("HUB_LIVE_SMOKE");
		expect(viteConfigSource).toContain("liveSmokeHubConfigPath");
		expect(viteConfigSource).toContain("configPath: liveSmokeHubConfigPath");
		expect(viteConfigSource).toContain("auxiliaryWorkers");
		expect(viteConfigSource).toContain("../app-api/wrangler.local-smoke.toml");
		expect(viteConfigSource).toContain("AUTH_SHELL_ORIGIN");
		expect(viteConfigSource).toContain("http://127.0.0.1:27012");
		expect(liveSmokeWranglerConfig).toContain("[secrets]");
		expect(liveSmokeWranglerConfig).toContain("required = []");
		expect(liveSmokeWranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(liveSmokeWranglerConfig).toContain('HUB_WEB_HOSTNAME = "127.0.0.1:27012"');
		expect(liveSmokeWranglerConfig).toContain(
			'AUTH_TURNSTILE_SITE_KEY = "1x00000000000000000000AA"',
		);
		expect(liveSmokeWranglerConfig).not.toContain("SENTRY_DSN");
	});

	it("keeps Sentry non-blocking while scrubbing auth-sensitive hub fields", () => {
		expect(workerSource).toContain("beforeSend(event)");
		expect(workerSource).toContain("sendDefaultPii: false");
		expect(workerSource).toContain('surface: "hub-web"');
		expect(workerSource).toContain('"authorization"');
		expect(workerSource).toContain('"cf-access-jwt-assertion"');
		expect(workerSource).toContain('"cookie"');
		expect(workerSource).toContain('"x-captcha-response"');
	});

	it("serves health without requiring app-api", async () => {
		const response = await worker.fetch(new Request("https://hub.muc.wiki/healthz"), createEnv());
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-hub-web",
			surface: "hub-web",
		});
	});

	it("allows only explicitly admitted app-api seams", async () => {
		const seen: string[] = [];
		const seenAuthorizationByPath = new Map<string, string | null>();
		const env = createEnv({
			fetch(request) {
				const pathname = new URL(request.url).pathname;
				seen.push(pathname);
				seenAuthorizationByPath.set(pathname, request.headers.get("authorization"));
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const allowed = await worker.fetch(new Request("https://hub.muc.wiki/api/me"), env);
		const overview = await worker.fetch(new Request("https://hub.muc.wiki/api/me/overview"), env);
		const identity = await worker.fetch(new Request("https://hub.muc.wiki/api/me/identity"), env);
		const access = await worker.fetch(new Request("https://hub.muc.wiki/api/me/access"), env);
		const preferencesGet = await worker.fetch(
			new Request("https://hub.muc.wiki/api/me/preferences"),
			env,
		);
		const preferencesPatch = await worker.fetch(
			new Request("https://hub.muc.wiki/api/me/preferences", {
				body: JSON.stringify({ profileMemoryEnabled: false }),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
			env,
		);
		const rejected = await worker.fetch(new Request("https://hub.muc.wiki/api/chat"), env);
		const federationAuthorize = await worker.fetch(
			new Request("https://hub.muc.wiki/api/federation/authorize"),
			env,
		);
		const federationToken = await worker.fetch(
			new Request("https://hub.muc.wiki/api/federation/token", {
				body: new URLSearchParams({ grant_type: "authorization_code" }),
				headers: { authorization: "Basic federation-client-secret" },
				method: "POST",
			}),
			env,
		);
		const federationUserinfo = await worker.fetch(
			new Request("https://hub.muc.wiki/api/federation/userinfo"),
			env,
		);
		const federationJwks = await worker.fetch(
			new Request("https://hub.muc.wiki/api/federation/jwks"),
			env,
		);
		const federationLogout = await worker.fetch(
			new Request("https://hub.muc.wiki/api/federation/logout"),
			env,
		);
		const rejectedFederation = await worker.fetch(
			new Request("https://hub.muc.wiki/api/federation/admin"),
			env,
		);
		const discovery = await worker.fetch(
			new Request("https://hub.muc.wiki/.well-known/openid-configuration", {
				headers: { accept: "application/json" },
			}),
			env,
		);
		const oauthMetadata = await worker.fetch(
			new Request("https://hub.muc.wiki/.well-known/oauth-authorization-server", {
				headers: { accept: "application/json" },
			}),
			env,
		);

		expect(allowed.status).toBe(200);
		expect(overview.status).toBe(200);
		expect(identity.status).toBe(200);
		expect(access.status).toBe(200);
		expect(preferencesGet.status).toBe(200);
		expect(preferencesPatch.status).toBe(200);
		expect(rejected.status).toBe(404);
		expect(federationAuthorize.status).toBe(200);
		expect(federationToken.status).toBe(200);
		expect(federationUserinfo.status).toBe(200);
		expect(federationJwks.status).toBe(200);
		expect(federationLogout.status).toBe(200);
		expect(rejectedFederation.status).toBe(404);
		expect(discovery.status).toBe(200);
		expect(oauthMetadata.status).toBe(200);
		expect(seenAuthorizationByPath.get("/api/me")).toBeNull();
		expect(seenAuthorizationByPath.get("/api/federation/token")).toBe(
			"Basic federation-client-secret",
		);
		expect(seen).toEqual([
			"/api/me",
			"/api/me/overview",
			"/api/me/identity",
			"/api/me/access",
			"/api/me/preferences",
			"/api/me/preferences",
			"/api/federation/authorize",
			"/api/federation/token",
			"/api/federation/userinfo",
			"/api/federation/jwks",
			"/api/federation/logout",
			"/.well-known/openid-configuration",
			"/.well-known/oauth-authorization-server",
		]);
	});

	it("fails closed for unknown browser paths instead of serving fake app routes", async () => {
		const env = createEnv();
		const unknown = await worker.fetch(
			new Request("https://hub.muc.wiki/unknown", {
				headers: { accept: "application/json" },
			}),
			env,
		);
		const chat = await worker.fetch(
			new Request("https://hub.muc.wiki/chat", {
				headers: { accept: "application/json" },
			}),
			env,
		);
		const account = await worker.fetch(new Request("https://hub.muc.wiki/account/login"), env);
		const federationConsent = await worker.fetch(
			new Request("https://hub.muc.wiki/account/federation/consent"),
			env,
		);
		const federationError = await worker.fetch(
			new Request("https://hub.muc.wiki/account/federation/error"),
			env,
		);

		expect(unknown.status).toBe(404);
		expect(chat.status).toBe(404);
		expect(await unknown.json()).toMatchObject({
			error: {
				code: "not_found",
			},
		});
		expect(account.status).toBe(200);
		expect(federationConsent.status).toBe(200);
		expect(federationError.status).toBe(200);
		expect(account.headers.get("content-type")).toContain("text/html");
	});

	it("serves the hub not-found shell for browser HTML requests", async () => {
		const response = await worker.fetch(
			new Request("https://hub.muc.wiki/unknown", {
				headers: { accept: "text/html" },
			}),
			createEnv(),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(await response.text()).toContain("__HUB_AUTH_CONFIG__");
	});

	it("passes Vite development module requests to the asset runtime", async () => {
		const seen: string[] = [];
		const env = createEnv();
		env.ASSETS = {
			fetch(request) {
				seen.push(new URL(request.url).pathname);
				return new Response("dev module", {
					headers: { "content-type": "application/javascript" },
				});
			},
		};

		const viteClient = await worker.fetch(new Request("https://hub.muc.wiki/@vite/client"), env);
		const sourceModule = await worker.fetch(new Request("https://hub.muc.wiki/src/main.tsx"), env);

		expect(viteClient.status).toBe(200);
		expect(sourceModule.status).toBe(200);
		expect(seen).toEqual(["/@vite/client", "/src/main.tsx"]);
	});

	it("keeps Turnstile challenge origins admitted by hub CSP", async () => {
		const response = await worker.fetch(new Request("https://hub.muc.wiki/account/login"), {
			...createEnv(),
			AUTH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
		});
		const csp = response.headers.get("content-security-policy") ?? "";
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(csp).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
		expect(csp).toContain("frame-src https://challenges.cloudflare.com");
		expect(html).toContain("__HUB_AUTH_CONFIG__");
		expect(html).toContain("1x00000000000000000000AA");
	});

	it("redirects legacy public auth routes to hub account routes with return_to", async () => {
		const response = await worker.fetch(
			new Request("https://hub.muc.wiki/login?return_to=%2Fchat"),
			createEnv(),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://hub.muc.wiki/account/login?return_to=%2Fchat",
		);
	});
});
