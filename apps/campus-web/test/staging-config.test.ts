import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import stagingBrowserE2ESource from "../e2e/staging-browser.ts?raw";
import packageManifest from "../package.json";
import stagingPreflightSource from "../scripts/preflight-staging.ts?raw";
import uploadStagingVersionSource from "../scripts/upload-staging-version.ts?raw";
import verifyStagingConfigSource from "../scripts/verify-staging-config.ts?raw";
import viteConfigSource from "../vite.config.ts?raw";
import wranglerConfig from "../wrangler.toml?raw";

const packageScripts = packageManifest.scripts as Record<string, string | undefined>;
const parsedWranglerConfig = parse(wranglerConfig) as {
	env?: { staging?: { observability?: unknown } };
	observability?: unknown;
};

describe("campus web staging config", () => {
	it("exports only application logs to the staging Axiom destination", () => {
		expect(parsedWranglerConfig.observability).toEqual({
			enabled: true,
			logs: {
				enabled: true,
				head_sampling_rate: 1,
				invocation_logs: false,
				persist: false,
			},
			traces: {
				enabled: false,
				head_sampling_rate: 0,
				persist: false,
			},
		});
		expect(parsedWranglerConfig.env?.staging?.observability).toEqual({
			enabled: true,
			logs: {
				destinations: ["axiom-staging-logs"],
				enabled: true,
				head_sampling_rate: 1,
				invocation_logs: false,
				persist: false,
			},
			traces: {
				enabled: false,
				head_sampling_rate: 0,
				persist: false,
			},
		});
	});

	it("keeps traffic ownership out of Wrangler and injects Turnstile at upload time", () => {
		expect(wranglerConfig).not.toContain("[[env.staging.routes]]");
		expect(wranglerConfig).toContain('CAMPUS_WEB_HOSTNAME = "campus-staging.mucwiki-edge.link"');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(wranglerConfig).toContain('bucket_name = "campus-agent-derived-unconfigured"');
		expect(wranglerConfig).not.toContain('bucket_name = "campus-agent-derived-staging"');
		expect(wranglerConfig).not.toContain("[env.staging.secrets]");
		expect(wranglerConfig).toContain("upload_source_maps = true");
		expect(wranglerConfig).toContain("persist = false");
		expect(wranglerConfig).toContain('destinations = ["axiom-staging-logs"]');
		expect(wranglerConfig).toContain("invocation_logs = false");
		expect(wranglerConfig).not.toContain("axiom-staging-traces");

		expect(verifyStagingConfigSource).toContain("CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(verifyStagingConfigSource).toContain("campus-staging.mucwiki-edge.link");
		expect(verifyStagingConfigSource).toContain("AUTH_TURNSTILE_SITE_KEY must not remain");
		expect(verifyStagingConfigSource).toContain("DOCS_RELEASE_ID must be injected");

		expect(uploadStagingVersionSource).toContain("CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(uploadStagingVersionSource).toContain("SENTRY_CAMPUS_WEB_DSN");
		expect(uploadStagingVersionSource).not.toContain("STAGING_CAMPUS_WEB_BROWSER_SENTRY_DSN");
		expect(uploadStagingVersionSource).not.toContain("STAGING_CAMPUS_WEB_EDGE_SENTRY_DSN");
		expect(uploadStagingVersionSource).toContain("SENTRY_CAMPUS_WEB_PROJECT_SLUG");
		expect(uploadStagingVersionSource).toContain('artifactDirectory: "dist/campus_web"');
		expect(uploadStagingVersionSource).toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(uploadStagingVersionSource).toContain("MAP_DATA_BUCKET_NAME");
		expect(uploadStagingVersionSource).toContain("uploadStagingWorkerVersion");
		expect(packageScripts["deploy:staging"]).toBeUndefined();
		expect(packageScripts["upload:staging"]).toContain("upload-staging-version.ts");
	});

	it("builds and uploads the complete staging surface from the release workflow", () => {
		const publishWorkflowSource = readFileSync(
			"../../.github/workflows/execution-runtime-publish.yml",
			"utf8",
		);
		const promotionScriptSource = readFileSync(
			"../../scripts/deploy/update-staging-candidate.sh",
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
		expect(promotionScriptSource).toContain("docsReleaseId");
		expect(promotionScriptSource).toContain("buildIdentity");
		expect(publishWorkflowSource).not.toContain("STAGING_APP_API_OPERATOR_DATABASE_URL");
		expect(publishWorkflowSource).not.toContain("deploy-staging.yml");
		expect(stagingPreflightSource).not.toContain('"build:staging"');
		expect(stagingPreflightSource).not.toContain('"build:app:staging"');
		expect(stagingPreflightSource).toContain("worker-staging-campus-web");
		expect(stagingPreflightSource).toContain("check-worker-secret-presence.ts");
		expect(stagingPreflightSource).toContain("apps/campus-web/scripts/verify-staging-config.ts");
		expect(stagingPreflightSource).toContain("apps/campus-web/dist/campus_web/wrangler.json");
		expect(viteConfigSource).toContain("sentryVitePlugin");
		expect(viteConfigSource).toContain('sourcemap: sentryUpload ? ("hidden" as const) : false');
		expect(viteConfigSource).toContain('filesToDeleteAfterUpload: "./dist/client/**/*.map"');
		expect(viteConfigSource).toContain("CAMPUS_WEB_SENTRY_SOURCE_MAP_UPLOAD");
		expect(viteConfigSource).toContain("SENTRY_CAMPUS_WEB_PROJECT_SLUG");
		expect(viteConfigSource).toContain("SENTRY_ORG_SLUG");
		expect(viteConfigSource).toContain("SENTRY_ALLOW_FAILURE must be unset");
		expect(viteConfigSource).toContain('url: "https://sentry.io"');
		expect(viteConfigSource).not.toContain("process.env.SENTRY_PROJECT");
	});

	it("keeps staging browser e2e credentialed and evidence-producing", () => {
		expect(stagingBrowserE2ESource).toContain('from "playwright"');
		expect(stagingBrowserE2ESource).toContain("APP_API_STAGING_SMOKE_AUTH_SECRET");
		expect(stagingBrowserE2ESource).not.toContain("STAGING_APP_API_SMOKE_AUTH_SECRET");
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
