import { describe, expect, it } from "vitest";

import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import wranglerConfig from "../wrangler.toml?raw";
import { packageManifest } from "./worker-shell-fixtures";

describe("public chat web staging config", () => {
	it("declares the staging custom domain, app-api staging binding, and deploy gates", () => {
		expect(wranglerConfig).toContain("workers_dev = false");
		expect(wranglerConfig).toContain("preview_urls = false");
		expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
		expect(wranglerConfig).toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('pattern = "chat-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain("[[env.staging.services]]");
		expect(wranglerConfig).toContain('binding = "APP_API"');
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain("[env.staging.vars]");
		expect(wranglerConfig).toContain('PUBLIC_CHAT_HOSTNAME = "chat-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(wranglerConfig).toContain(
			'AUTH_SHELL_ORIGIN = "https://campus-staging.mucwiki-edge.link"',
		);
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(wranglerConfig).toContain('SENTRY_ENVIRONMENT = "staging"');
		expect(wranglerConfig).not.toContain("SENTRY_RELEASE = ");
		expect(packageManifest.scripts?.build).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["build:staging"]).toContain("CLOUDFLARE_ENV=staging");
		expect(packageManifest.scripts?.["build:staging"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.dev).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.preview).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy:preflight:staging");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toContain(
			"run-worker-staging-preflight.mjs",
		);
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toContain(
			"check_worker_secret_presence.py",
		);
		expect(deployStagingSource).toContain("buildWranglerCommandEnv");
		expect(deployStagingSource).toContain("loadRepoStagingEnvFile");
		expect(deployStagingSource).toContain("resolveStagingSentryRelease");
		expect(deployStagingSource).not.toContain("STAGING_AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).not.toContain("STAGING_AUTH_TURNSTILE_APPEARANCE");
		expect(deployStagingSource).not.toContain("STAGING_AUTH_TURNSTILE_EXECUTION");
		expect(deployStagingSource).not.toContain("AUTH_TURNSTILE_SITE_KEY:");
		expect(deployStagingSource).not.toContain("AUTH_TURNSTILE_APPEARANCE:");
		expect(deployStagingSource).not.toContain("AUTH_TURNSTILE_EXECUTION:");
		expect(deployStagingSource).toContain("SENTRY_RELEASE:");
		expect(verifyStagingConfigSource).not.toContain("STAGING_AUTH_TURNSTILE_APPEARANCE");
		expect(verifyStagingConfigSource).not.toContain("STAGING_AUTH_TURNSTILE_EXECUTION");
		expect(verifyStagingConfigSource).toContain("https://app-api.internal");
		expect(verifyStagingConfigSource).not.toContain("https://api-staging.mucwiki-edge.link");
		expect(verifyStagingConfigSource).toContain("custom_domain === true");
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
			"XDG_CONFIG_HOME=./.wrangler-home",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
			"verify-staging-config.mjs",
		);
	});

	it("declares required secrets for local and staging worker environments", () => {
		expect(wranglerConfig).toContain("[env.staging.secrets]");
		expect(wranglerConfig).toContain('required = ["SENTRY_DSN"]');
	});
});
