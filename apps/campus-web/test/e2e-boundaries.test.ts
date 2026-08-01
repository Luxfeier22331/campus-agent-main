import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("campus web browser test boundaries", () => {
	it("keeps worker specs out of the SPA project and supports a prebuilt app", () => {
		const config = readFileSync("e2e.config.ts", "utf8");

		expect(config).toContain('testIgnore: ["worker/**"]');
		expect(config).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(config).toContain("pnpm run build:test");
		expect(config).toContain("vite preview");
		expect(config).not.toContain("vite --host");
		expect(config).toContain("failOnFlakyTests: isCI");
	});

	it("uses the same prebuilt test Worker for browser boundaries", () => {
		const workerConfig = readFileSync("e2e.worker.config.ts", "utf8");
		const turboConfig = readFileSync("turbo.json", "utf8");

		expect(workerConfig).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(workerConfig).toContain("CLOUDFLARE_ENV=local pnpm run build:test &&");
		expect(workerConfig).toContain("pnpm exec wrangler dev --config dist/campus_web/wrangler.json");
		expect(workerConfig).toContain("--var APP_API_BASE_URL:http://127.0.0.1:27031");
		expect(workerConfig).toContain("e2e/support/app-api-stub.ts");
		expect(workerConfig).not.toContain("globalSetup");
		expect(workerConfig).not.toContain("pnpm exec vite --host");
		expect(turboConfig).toContain('"build:test"');
		expect(turboConfig).toContain('".generated/docs-content/sources/**"');
		expect(turboConfig).not.toContain("_docs-static");
	});

	it("keeps browser regressions outside automatic PR checks and available on demand", () => {
		const prWorkflow = readFileSync("../../.github/workflows/pr.yml", "utf8");
		const healthWorkflow = readFileSync("../../.github/workflows/health.yml", "utf8");
		const browserJob = healthWorkflow.slice(
			healthWorkflow.indexOf("\n  browser:"),
			healthWorkflow.indexOf("\n  go:"),
		);

		expect(prWorkflow).toContain("Run repository checks");
		expect(prWorkflow).not.toContain("playwright");
		expect(prWorkflow).not.toContain("test:e2e");
		expect(prWorkflow).not.toContain("OBJECT_STORE_");
		expect(browserJob).toContain('CAMPUS_WEB_E2E_PREBUILT: "1"');
		expect(browserJob).toContain("CLOUDFLARE_ENV=local pnpm turbo run build:worker");
		expect(browserJob).toContain("test:e2e:full");
		expect(browserJob).toContain("apps/ops-web test:browser");
		expect(browserJob).toContain("actions/upload-artifact@");
		expect(browserJob).toContain("retention-days: 7");
	});
});
