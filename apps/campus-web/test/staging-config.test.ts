import { describe, expect, it } from "vitest";

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
});
