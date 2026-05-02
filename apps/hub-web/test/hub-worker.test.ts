import { describe, expect, it } from "vitest";
import stagingPreflightSource from "../../../scripts/run-worker-staging-preflight.mjs?raw";
import packageManifestRaw from "../package.json?raw";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import worker, { type Env } from "../src/index";
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
		expect(wranglerConfig).toContain('pattern = "hub-staging.muc.wiki"');
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerConfig).toContain('HUB_WEB_HOSTNAME = "hub-staging.muc.wiki"');
		expect(wranglerConfig).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).toContain("STAGING_HUB_AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).toContain("hub-staging.muc.wiki");
		expect(verifyStagingConfigSource).toContain("STAGING_HUB_AUTH_TURNSTILE_SITE_KEY");
		expect(stagingPreflightSource).toContain('"apps/hub-web"');
		expect(stagingPreflightSource).toContain("worker-staging-hub-web");
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
		const env = createEnv({
			fetch(request) {
				seen.push(new URL(request.url).pathname);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const allowed = await worker.fetch(new Request("https://hub.muc.wiki/api/me"), env);
		const rejected = await worker.fetch(new Request("https://hub.muc.wiki/api/chat"), env);

		expect(allowed.status).toBe(200);
		expect(rejected.status).toBe(404);
		expect(seen).toEqual(["/api/me"]);
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
