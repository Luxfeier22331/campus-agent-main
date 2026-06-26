import { describe, expect, it } from "vitest";

import stagingPreflightSource from "../../../scripts/run-worker-staging-preflight.mjs?raw";
import packageManifest from "../package.json";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import stagingBrowserE2ESource from "../scripts/staging-browser-e2e.ts?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import wranglerConfig from "../wrangler.toml?raw";

const packageScripts = packageManifest.scripts as Record<string, string | undefined>;

describe("campus web staging config", () => {
	it("keeps campus staging host and injects Turnstile sitekey only at deploy time", () => {
		expect(wranglerConfig).toContain('pattern = "campus-staging.mucwiki-edge.link"');
		expect(wranglerConfig).toContain('CAMPUS_WEB_HOSTNAME = "campus-staging.mucwiki-edge.link"');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");

		expect(verifyStagingConfigSource).toContain("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(verifyStagingConfigSource).toContain("campus-staging.mucwiki-edge.link");
		expect(verifyStagingConfigSource).toContain("AUTH_TURNSTILE_SITE_KEY must not remain");

		expect(deployStagingSource).toContain("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(deployStagingSource).toContain("AUTH_TURNSTILE_SITE_KEY:");
		expect(deployStagingSource).toContain("AUTH_TURNSTILE_APPEARANCE:");
		expect(deployStagingSource).toContain("AUTH_TURNSTILE_EXECUTION:");
	});

	it("keeps app-only staging deploy separate from docs reader builds", () => {
		expect(packageScripts["build:app:staging"]).toContain("vite build");
		expect(packageScripts["build:app:staging"]).not.toContain("rspress");
		expect(packageScripts["build:app:staging"]).not.toContain("build-published-reader-docs.mjs");
		expect(packageScripts["build:docs:staging"]).toContain(
			"build-published-reader-docs.mjs --staging",
		);
		expect(packageScripts["build:staging"]).toBe(
			"pnpm run build:docs:staging && pnpm run build:app:staging",
		);
		expect(stagingPreflightSource).not.toContain('"build:staging"');
		expect(stagingPreflightSource).not.toContain('"build:app:staging"');
		expect(stagingPreflightSource).toContain("apps/campus-web/scripts/verify-staging-config.mjs");
		expect(stagingPreflightSource).toContain("apps/campus-web/dist/campus_web/wrangler.json");
	});

	it("keeps staging browser e2e credentialed and evidence-producing", () => {
		expect(stagingBrowserE2ESource).toContain('from "playwright"');
		expect(stagingBrowserE2ESource).toContain("APP_API_STAGING_SMOKE_AUTH_SECRET");
		expect(stagingBrowserE2ESource).toContain("STAGING_APP_API_SMOKE_AUTH_SECRET");
		expect(stagingBrowserE2ESource).toContain("/api/internal/staging-smoke/auth/session");
		expect(stagingBrowserE2ESource).toContain("E2E_QA_EVIDENCE_DIR");
		expect(stagingBrowserE2ESource).toContain("campus-browser-e2e.json");
		expect(stagingBrowserE2ESource).toContain("/api/chat/runs/");
		expect(stagingBrowserE2ESource).toContain("/docs/regulations/student_rules/");
		expect(packageScripts["browser:e2e:staging"]).toBeUndefined();
		expect(packageScripts["browser:smoke:staging"]).toBeUndefined();
	});
});
