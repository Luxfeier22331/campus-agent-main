import { expect, it } from "vitest";

import {
	deployStagingSource,
	localAccessSmokeServerSource,
	packageManifest,
	viteConfigSource,
	wranglerConfig,
	wranglerLocalSmokeConfig,
} from "./worker.test-support";

export function registerWorkerRuntimeConfigSuite() {
	it("declares the staging custom domain, app-api staging binding, and deploy gates", () => {
		expect(packageManifest.dependencies?.["@mui/x-charts"]).toBeTruthy();
		expect(wranglerConfig).toContain("workers_dev = false");
		expect(wranglerConfig).toContain("preview_urls = false");
		expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
		expect(wranglerConfig).toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('pattern = "campus-panel-staging.ayafeed.com"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain("[env.local.vars]");
		expect(wranglerConfig).toContain('PANEL_RUNTIME_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerConfig).toContain('ACCESS_TEAM_DOMAIN = "http://127.0.0.1:9798"');
		expect(wranglerConfig).toContain('ACCESS_POLICY_AUD = "panel-local-smoke"');
		expect(wranglerConfig).toContain("[[env.local.services]]");
		expect(wranglerConfig).toContain('environment = "local"');
		expect(wranglerConfig).toContain("[env.local.secrets]");
		expect(wranglerConfig).toContain("[[env.staging.services]]");
		expect(wranglerConfig).toContain('binding = "APP_API"');
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain("[env.staging.vars]");
		const stagingVarsBlock = wranglerConfig.split("[env.staging.vars]")[1] ?? "";
		expect(stagingVarsBlock).toContain('PANEL_RUNTIME_API_BASE_URL = "https://app-api.internal"');
		expect(stagingVarsBlock).toContain('PANEL_PROTECTION_ENVELOPE = "cloudflare-access"');
		expect(stagingVarsBlock).not.toContain("ACCESS_TEAM_DOMAIN");
		expect(stagingVarsBlock).not.toContain("ACCESS_POLICY_AUD");
		expect(stagingVarsBlock).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(stagingVarsBlock).not.toContain("SENTRY_RELEASE = ");
		expect(deployStagingSource).toContain("SENTRY_RELEASE:");
		expect(deployStagingSource).toContain("resolveStagingSentryRelease");
		expect(deployStagingSource).toContain("STAGING_ACCESS_TEAM_DOMAIN must start with https://");
		expect(deployStagingSource).not.toContain("must start with http:// or https://");
		expect(packageManifest.scripts?.build).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["build:staging"]).toContain("CLOUDFLARE_ENV=staging");
		expect(packageManifest.scripts?.["build:staging"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.dev).toContain("CLOUDFLARE_ENV=local");
		expect(packageManifest.scripts?.dev).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("PANEL_LIVE_SMOKE=1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--port 5174");
		expect(packageManifest.scripts?.["dev:live-smoke"]).not.toContain("CLOUDFLARE_ENV=local");
		expect(packageManifest.scripts?.preview).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.["dev:live-smoke:access"]).toContain(
			"local-access-smoke-server.mjs",
		);
		expect(viteConfigSource).toContain("auxiliaryWorkers");
		expect(viteConfigSource).toContain("wrangler.local-smoke.toml");
		expect(viteConfigSource).toContain("../app-api/wrangler.local-smoke.toml");
		expect(viteConfigSource).toContain("liveSmokeSupervisorApiBaseUrl");
		expect(viteConfigSource).toContain("process.env.SUPERVISOR_API_BASE_URL");
		expect(viteConfigSource).toContain("http://127.0.0.1:18080");
		expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("pnpm deploy:preflight:staging");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toContain(
			"run-worker-staging-preflight.mjs",
		);
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toContain(
			"check_worker_secret_presence.py",
		);
		expect(deployStagingSource).toContain("buildWranglerCommandEnv");
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
			"XDG_CONFIG_HOME=./.wrangler-home",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"verify-worker-deploy-config.mjs",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"dist/protected_panel_web/wrangler.json",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"SERVICE:APP_API=app-api-staging",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"VAR:PANEL_RUNTIME_API_BASE_URL=https://app-api.internal",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"VAR_ABSENT:SENTRY_RELEASE",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"ROUTE:campus-panel-staging.ayafeed.com",
		);
	});

	it("provides an access-compatible local issuer for authenticated live smoke", () => {
		expect(wranglerLocalSmokeConfig).toContain("[secrets]");
		expect(wranglerLocalSmokeConfig).toContain('required = ["PANEL_APP_API_SHARED_SECRET"]');
		expect(wranglerLocalSmokeConfig).toContain('ACCESS_TEAM_DOMAIN = "http://127.0.0.1:9798"');
		expect(wranglerLocalSmokeConfig).toContain('ACCESS_POLICY_AUD = "panel-local-smoke"');
		expect(localAccessSmokeServerSource).toContain("generateKeyPair");
		expect(localAccessSmokeServerSource).toContain("SignJWT");
		expect(localAccessSmokeServerSource).toContain("/cdn-cgi/access/certs");
		expect(localAccessSmokeServerSource).toContain("CF_Authorization");
		expect(localAccessSmokeServerSource).toContain("panel-local-smoke");
		expect(localAccessSmokeServerSource).toContain(".setIssuer(issuer)");
		expect(localAccessSmokeServerSource).toContain(".setAudience(audience)");
		expect(localAccessSmokeServerSource).toContain("SameSite=Lax");
	});

	it("declares required secrets for local and staging worker environments", () => {
		expect(wranglerConfig).toContain("[secrets]");
		expect(wranglerConfig).toContain('required = ["PANEL_APP_API_SHARED_SECRET"]');
		expect(wranglerConfig).toContain("[env.staging.secrets]");
		expect(wranglerConfig).toContain('"PANEL_APP_API_SHARED_SECRET"');
		expect(wranglerConfig).toContain('"SENTRY_DSN"');
	});
}
