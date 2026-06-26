import { describe, expect, it } from "vitest";

import stagingPreflightSource from "../../../scripts/run-worker-staging-preflight.mjs?raw";
import packageManifest from "../package.json";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.mjs?raw";
import wranglerConfig from "../wrangler.toml?raw";

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
		expect(packageManifest.scripts?.["build:app:staging"]).toContain("vite build");
		expect(packageManifest.scripts?.["build:app:staging"]).not.toContain("rspress");
		expect(packageManifest.scripts?.["build:app:staging"]).not.toContain(
			"build-published-reader-docs.mjs",
		);
		expect(packageManifest.scripts?.["build:docs:staging"]).toContain(
			"build-published-reader-docs.mjs --staging",
		);
		expect(packageManifest.scripts?.["build:staging"]).toBe(
			"pnpm run build:docs:staging && pnpm run build:app:staging",
		);
		expect(stagingPreflightSource).not.toContain('"build:staging"');
		expect(stagingPreflightSource).not.toContain('"build:app:staging"');
		expect(stagingPreflightSource).toContain("apps/campus-web/scripts/verify-staging-config.mjs");
		expect(stagingPreflightSource).toContain("apps/campus-web/dist/campus_web/wrangler.json");
	});
});
