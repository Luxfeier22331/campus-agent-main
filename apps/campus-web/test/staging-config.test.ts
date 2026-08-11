import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import stagingBrowserE2ESource from "../e2e/staging-browser.ts?raw";
import packageManifest from "../package.json";
import buildCampusWebSource from "../scripts/build-campus-web.ts?raw";
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
	it("leaves Worker observability ownership to GitOps", () => {
		expect(parsedWranglerConfig.observability).toBeUndefined();
		expect(parsedWranglerConfig.env?.staging).not.toHaveProperty("observability");
	});

	it("keeps traffic ownership out of Wrangler and injects Turnstile at upload time", () => {
		expect(wranglerConfig).not.toContain("[[env.staging.routes]]");
		expect(wranglerConfig).not.toContain("CAMPUS_WEB_HOSTNAME");
		expect(wranglerConfig).toContain('DEPLOYMENT_ENVIRONMENT = "staging"');
		expect(wranglerConfig).not.toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(wranglerConfig).not.toContain("MAP_DATA");
		expect(wranglerConfig).not.toContain("r2_buckets");
		expect(wranglerConfig).not.toContain("[env.staging.secrets]");
		expect(wranglerConfig).toContain("upload_source_maps = true");
		expect(wranglerConfig).not.toContain("[observability");
		expect(wranglerConfig).not.toContain("axiom-staging-traces");

		expect(verifyStagingConfigSource).toContain("CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(verifyStagingConfigSource).not.toContain("CAMPUS_WEB_HOSTNAME");
		expect(stagingPreflightSource).toContain("STATUS_WEB_PUBLIC_ORIGIN");
		expect(verifyStagingConfigSource).toContain("DEPLOYMENT_ENVIRONMENT");
		expect(verifyStagingConfigSource).toContain("AUTH_TURNSTILE_SITE_KEY must not remain");
		expect(uploadStagingVersionSource).toContain("CAMPUS_AUTH_TURNSTILE_SITE_KEY");
		expect(uploadStagingVersionSource).toContain("SENTRY_CAMPUS_WEB_DSN");
		expect(uploadStagingVersionSource).not.toContain("STAGING_CAMPUS_WEB_BROWSER_SENTRY_DSN");
		expect(uploadStagingVersionSource).not.toContain("STAGING_CAMPUS_WEB_EDGE_SENTRY_DSN");
		expect(uploadStagingVersionSource).toContain("SENTRY_CAMPUS_WEB_PROJECT_SLUG");
		expect(uploadStagingVersionSource).toContain('artifactDirectory: "dist/campus_web"');
		expect(uploadStagingVersionSource).toContain("AUTH_TURNSTILE_SITE_KEY");
		expect(uploadStagingVersionSource).toContain("STATUS_WEB_PUBLIC_ORIGIN");
		expect(verifyStagingConfigSource).not.toContain("MAP_DATA");
		expect(buildCampusWebSource).not.toContain("MAP_DATA");
		expect(uploadStagingVersionSource).toContain("readCampusWebBuildSourceDigest");
		expect(uploadStagingVersionSource).toContain("candidateMetadata: { docsSourceDigest }");
		expect(uploadStagingVersionSource).toContain("uploadStagingWorkerVersion");
		expect(packageScripts["deploy:staging"]).toBeUndefined();
		expect(packageScripts["upload:staging"]).toContain("upload-staging-version.ts");
	});

	it("builds and uploads the Campus Web staging candidate", () => {
		expect(packageScripts["build:app:staging"]).toBeUndefined();
		expect(packageScripts["build:docs:staging"]).toBeUndefined();
		expect(packageScripts["build:staging"]).toBe(
			"pnpm exec tsx ./scripts/build-campus-web.ts --staging",
		);
		expect(stagingPreflightSource).not.toContain('"build:staging"');
		expect(stagingPreflightSource).not.toContain('"build:app:staging"');
		expect(stagingPreflightSource).not.toContain("check-worker-secret-presence.ts");
		expect(stagingPreflightSource).toContain("apps/campus-web/scripts/verify-staging-config.ts");
		expect(stagingPreflightSource).toContain("apps/campus-web/dist/campus_web/wrangler.json");
		expect(verifyStagingConfigSource).toContain(
			'Object.hasOwn(environments?.staging ?? {}, "observability")',
		);
		expect(viteConfigSource).toContain("sentryVitePlugin");
		expect(viteConfigSource).toContain('sourcemap: sentryUpload ? ("hidden" as const) : false');
		expect(viteConfigSource).toContain('filesToDeleteAfterUpload: "./dist/client/**/*.map"');
		expect(viteConfigSource).toContain("CAMPUS_WEB_SENTRY_SOURCE_MAP_UPLOAD");
		expect(viteConfigSource).toContain("SENTRY_CAMPUS_WEB_PROJECT_SLUG");
		expect(viteConfigSource).toContain("SENTRY_ORG_SLUG");
		expect(viteConfigSource).toContain("SENTRY_ALLOW_FAILURE must be unset");
		expect(viteConfigSource).toContain('url: "https://sentry.io"');
		expect(viteConfigSource).not.toContain("SENTRY_PROJECT");
	});

	it("keeps staging browser e2e credentialed and evidence-producing", () => {
		expect(stagingBrowserE2ESource).toContain('from "playwright"');
		expect(stagingBrowserE2ESource).toContain('"--email is required."');
		expect(stagingBrowserE2ESource).toContain('"--password is required."');
		expect(stagingBrowserE2ESource).toContain('"--captcha-token is required."');
		expect(stagingBrowserE2ESource).toContain("/api/auth/sign-in/email");
		expect(stagingBrowserE2ESource).not.toContain("/api/internal/staging-smoke/auth/session");
		expect(stagingBrowserE2ESource).toContain("var/staging-evidence/campus-browser-e2e");
		expect(stagingBrowserE2ESource).toContain("campus-browser-e2e.json");
		expect(stagingBrowserE2ESource).toContain('page.goto("/",');
		expect(stagingBrowserE2ESource).not.toContain('page.goto("/chat"');
		expect(stagingBrowserE2ESource).toContain("/api/chat/runs/");
		expect(stagingBrowserE2ESource).toContain("/docs/regulations/student_rules/doc-c62077b20430");
		expect(packageScripts["browser:e2e:staging"]).toBeUndefined();
		expect(packageScripts["browser:smoke:staging"]).toBeUndefined();
	});
});
