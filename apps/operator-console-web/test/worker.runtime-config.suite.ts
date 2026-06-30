import { expect, it } from "vitest";

import {
	deployStagingSource,
	localAccessSmokeServerSource,
	packageManifest,
	stagingAccessServiceTokenSmokeSource,
	stagingBrowserE2ESource,
	viteConfigSource,
	wranglerConfig,
	wranglerLocalSmokeConfig,
} from "./worker.test-support";

export function registerWorkerRuntimeConfigSuite() {
	it("declares the staging custom domain, app-api staging binding, and deploy gates", () => {
		expect(packageManifest.dependencies?.["react-admin"]).toBeUndefined();
		expect(packageManifest.dependencies?.["@mui/x-charts"]).toBeUndefined();
		expect(packageManifest.dependencies?.["@radix-ui/react-slot"]).toBeTruthy();
		expect(wranglerConfig).toContain("workers_dev = false");
		expect(wranglerConfig).toContain("preview_urls = false");
		expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
		expect(wranglerConfig).toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('pattern = "panel-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain("custom_domain = true");
		expect(wranglerConfig).toContain("[env.local.vars]");
		expect(wranglerConfig).toContain(
			'OPERATOR_CONSOLE_APP_API_BASE_URL = "https://app-api.internal"',
		);
		expect(wranglerConfig).toContain('ACCESS_TEAM_DOMAIN = "http://127.0.0.1:27062"');
		expect(wranglerConfig).toContain('ACCESS_POLICY_AUD = "operator-console-local-smoke"');
		expect(wranglerConfig).toContain("[[env.local.services]]");
		expect(wranglerConfig).toContain('environment = "local"');
		expect(wranglerConfig).toContain("[env.local.secrets]");
		expect(wranglerConfig).toContain("[[env.staging.services]]");
		expect(wranglerConfig).toContain('binding = "APP_API"');
		expect(wranglerConfig).toContain('service = "app-api-staging"');
		expect(wranglerConfig).toContain("[env.staging.vars]");
		const stagingVarsBlock = wranglerConfig.split("[env.staging.vars]")[1] ?? "";
		expect(stagingVarsBlock).toContain(
			'OPERATOR_CONSOLE_APP_API_BASE_URL = "https://app-api.internal"',
		);
		expect(stagingVarsBlock).toContain(
			'OPERATOR_CONSOLE_PROTECTION_ENVELOPE = "cloudflare-access"',
		);
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
		expect(packageManifest.scripts?.["build:staging"]).toContain("run-worker-staging-build.mjs");
		expect(packageManifest.scripts?.["build:staging"]).toContain(
			"OPERATOR_CONSOLE_APP_API_SHARED_SECRET",
		);
		expect(packageManifest.scripts?.["build:staging"]).toContain("SENTRY_DSN");
		expect(packageManifest.scripts?.dev).toContain("CLOUDFLARE_ENV=local");
		expect(packageManifest.scripts?.dev).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.dev).toContain("--port 27021");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toBeUndefined();
		expect(packageManifest.scripts?.preview).toContain("WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1");
		expect(packageManifest.scripts?.["test:worker"]).toContain(
			"WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1",
		);
		expect(packageManifest.scripts?.["dev:live-smoke:access"]).toBeUndefined();
		expect(packageManifest.scripts?.["access:smoke:staging"]).toBeUndefined();
		expect(stagingAccessServiceTokenSmokeSource).toContain(
			"STAGING_OPERATOR_CONSOLE_ACCESS_CLIENT_ID",
		);
		expect(stagingAccessServiceTokenSmokeSource).toContain(
			"STAGING_OPERATOR_CONSOLE_ACCESS_CLIENT_SECRET",
		);
		expect(stagingAccessServiceTokenSmokeSource).toContain("loadRepoStagingEnvFile");
		expect(stagingAccessServiceTokenSmokeSource).not.toContain("loadRepoEnvFile");
		expect(stagingAccessServiceTokenSmokeSource).toContain("CF-Access-Client-Id");
		expect(stagingAccessServiceTokenSmokeSource).toContain(
			"Service-token provider-config route smoke",
		);
		expect(stagingBrowserE2ESource).toContain('from "playwright"');
		expect(stagingBrowserE2ESource).toContain("OPERATOR_CONSOLE_STORAGE_STATE");
		expect(stagingBrowserE2ESource).toContain(
			"service-token smoke does not prove human operator browser E2E",
		);
		expect(stagingBrowserE2ESource).toContain("E2E_QA_EVIDENCE_DIR");
		expect(stagingBrowserE2ESource).toContain("operator-console-browser-e2e.json");
		expect(stagingBrowserE2ESource).toContain("assertNoDirectRuntimeRequests");
		expect(stagingBrowserE2ESource).toContain(
			"temporal|execution-control|sentry|axiom|postgres|pg",
		);
		expect(stagingBrowserE2ESource).toContain("/observability/overview");
		expect(packageManifest.devDependencies?.playwright).toBeTruthy();
		expect(packageManifest.scripts?.["browser:e2e:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["browser:smoke:staging"]).toBeUndefined();
		expect(viteConfigSource).toContain("auxiliaryWorkers");
		expect(viteConfigSource).toContain("wrangler.local-smoke.toml");
		expect(viteConfigSource).toContain("../app-api/wrangler.local-smoke.toml");
		expect(viteConfigSource).toContain("liveSmokeExecutionControlBaseUrl");
		expect(viteConfigSource).toContain("process.env.EXECUTION_CONTROL_BASE_URL");
		expect(viteConfigSource).toContain("http://127.0.0.1:27051");
		expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
		expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain("deploy:preflight:staging");
		expect(packageManifest.scripts?.["deploy:preflight:staging"]).toBeUndefined();
		expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toBeUndefined();
		expect(deployStagingSource).toContain("buildWranglerCommandEnv");
		expect(deployStagingSource).toContain("loadRepoStagingEnvFile");
		expect(deployStagingSource).toContain('loadRepoStagingEnvFile(import.meta.url, "../../..")');
		expect(deployStagingSource).toContain("run-worker-staging-preflight.mjs");
		expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
			"XDG_CONFIG_HOME=./.wrangler-home",
		);
		expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toBeUndefined();
	});

	it("provides an access-compatible local issuer for authenticated live smoke", () => {
		expect(wranglerLocalSmokeConfig).toContain("[secrets]");
		expect(wranglerLocalSmokeConfig).toContain(
			'required = ["OPERATOR_CONSOLE_APP_API_SHARED_SECRET"]',
		);
		expect(wranglerLocalSmokeConfig).toContain('ACCESS_TEAM_DOMAIN = "http://127.0.0.1:27062"');
		expect(wranglerLocalSmokeConfig).toContain(
			'ACCESS_POLICY_AUD = "operator-console-local-smoke"',
		);
		expect(localAccessSmokeServerSource).toContain("generateKeyPair");
		expect(localAccessSmokeServerSource).toContain("SignJWT");
		expect(localAccessSmokeServerSource).toContain("/cdn-cgi/access/certs");
		expect(localAccessSmokeServerSource).toContain("CF_Authorization");
		expect(localAccessSmokeServerSource).toContain("operator-console-local-smoke");
		expect(localAccessSmokeServerSource).toContain(".setIssuer(issuer)");
		expect(localAccessSmokeServerSource).toContain(".setAudience(audience)");
		expect(localAccessSmokeServerSource).toContain("SameSite=Lax");
	});

	it("declares required secrets for local and staging worker environments", () => {
		expect(wranglerConfig).toContain("[secrets]");
		expect(wranglerConfig).toContain('required = ["OPERATOR_CONSOLE_APP_API_SHARED_SECRET"]');
		expect(wranglerConfig).toContain("[env.staging.secrets]");
		expect(wranglerConfig).toContain('"OPERATOR_CONSOLE_APP_API_SHARED_SECRET"');
		expect(wranglerConfig).toContain('"SENTRY_DSN"');
	});
}
