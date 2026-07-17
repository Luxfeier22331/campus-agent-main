import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import stagingBrowserE2ESource from "../e2e/staging-browser.ts?raw";
import packageManifest from "../package.json";
import stagingPreflightSource from "../scripts/preflight-staging.ts?raw";
import uploadStagingVersionSource from "../scripts/upload-staging-version.ts?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.ts?raw";
import wranglerConfig from "../wrangler.toml?raw";

const packageScripts = packageManifest.scripts as Record<string, string | undefined>;

describe("campus web staging config", () => {
	it("keeps traffic ownership out of Wrangler and injects Turnstile at upload time", () => {
		expect(wranglerConfig).not.toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('CAMPUS_WEB_HOSTNAME = "campus-staging.mucwiki-edge.link"');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(wranglerConfig).toContain('bucket_name = "campus-agent-derived-unconfigured"');
		expect(wranglerConfig).not.toContain('bucket_name = "campus-agent-derived-staging"');

		expect(verifyStagingConfigSource).toContain("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(verifyStagingConfigSource).toContain("campus-staging.mucwiki-edge.link");
		expect(verifyStagingConfigSource).toContain("AUTH_TURNSTILE_SITE_KEY must not remain");
		expect(verifyStagingConfigSource).toContain("DOCS_RELEASE_ID must be injected");

		expect(uploadStagingVersionSource).toContain("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(uploadStagingVersionSource).toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(uploadStagingVersionSource).toContain("STAGING_MAP_DATA_BUCKET_NAME");
		expect(uploadStagingVersionSource).toContain("uploadStagingWorkerVersion");
		expect(packageScripts["deploy:staging"]).toBeUndefined();
		expect(packageScripts["upload:staging"]).toContain("upload-staging-version.ts");
	});

	it("builds and uploads the complete staging surface from the release workflow", () => {
		const publishWorkflowSource = readFileSync(
			"../../.github/workflows/execution-runtime-publish.yml",
			"utf8",
		);

		expect(packageScripts["build:app:staging"]).toBeUndefined();
		expect(packageScripts["build:docs:staging"]).toBeUndefined();
		expect(packageScripts["build:staging"]).toBe(
			"pnpm exec tsx ./scripts/build-release.ts --staging",
		);
		expect(publishWorkflowSource).toContain("pnpm --dir apps/campus-web run build:staging");
		expect(publishWorkflowSource).toContain("pnpm --dir apps/campus-web upload:staging");
		expect(publishWorkflowSource).not.toContain("STAGING_CAMPUS_DOCS_READER_MANIFEST_KEY");
		expect(publishWorkflowSource).not.toContain("STAGING_CAMPUS_DOCS_READER_MANIFEST_SHA256");
		expect(publishWorkflowSource).toContain("docs-reader-release.json");
		expect(publishWorkflowSource).toContain(`--release-id "\${DOCS_RELEASE_ID}"`);
		expect(publishWorkflowSource).toContain("docsReleaseId");
		expect(publishWorkflowSource).toContain("buildIdentity");
		expect(publishWorkflowSource).not.toContain("STAGING_APP_API_OPERATOR_DATABASE_URL");
		expect(publishWorkflowSource).not.toContain("deploy-staging.yml");
		expect(stagingPreflightSource).not.toContain('"build:staging"');
		expect(stagingPreflightSource).not.toContain('"build:app:staging"');
		expect(stagingPreflightSource).toContain("worker-staging-campus-web");
		expect(stagingPreflightSource).toContain("check-worker-secret-presence.ts");
		expect(stagingPreflightSource).toContain("apps/campus-web/scripts/verify-staging-config.ts");
		expect(stagingPreflightSource).toContain("apps/campus-web/dist/campus_web/wrangler.json");
	});

	it("keeps staging browser e2e credentialed and evidence-producing", () => {
		expect(stagingBrowserE2ESource).toContain('from "playwright"');
		expect(stagingBrowserE2ESource).toContain("APP_API_STAGING_SMOKE_AUTH_SECRET");
		expect(stagingBrowserE2ESource).toContain("STAGING_APP_API_SMOKE_AUTH_SECRET");
		expect(stagingBrowserE2ESource).toContain("/api/internal/staging-smoke/auth/session");
		expect(stagingBrowserE2ESource).toContain("E2E_QA_EVIDENCE_DIR");
		expect(stagingBrowserE2ESource).toContain("campus-browser-e2e.json");
		expect(stagingBrowserE2ESource).toContain('page.goto("/",');
		expect(stagingBrowserE2ESource).not.toContain('page.goto("/chat"');
		expect(stagingBrowserE2ESource).toContain("/api/chat/runs/");
		expect(stagingBrowserE2ESource).toContain("/docs/regulations/student_rules/");
		expect(packageScripts["browser:e2e:staging"]).toBeUndefined();
		expect(packageScripts["browser:smoke:staging"]).toBeUndefined();
	});
});
