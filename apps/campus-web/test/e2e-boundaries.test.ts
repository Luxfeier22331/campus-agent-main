import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("campus web browser test boundaries", () => {
	it("keeps worker specs out of the SPA project and supports a prebuilt app", () => {
		const config = readFileSync("e2e.config.ts", "utf8");

		expect(config).toContain('testIgnore: ["worker/**"]');
		expect(config).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(config).toContain("pnpm run build:test");
		expect(config).toContain('trace: "retain-on-failure"');
		expect(config).toContain("vite preview");
		expect(config).not.toContain("vite --host");
		expect(config).toContain("failOnFlakyTests: isCI");
	});

	it("uses the same prebuilt test Worker for browser boundaries", () => {
		const workerConfig = readFileSync("e2e.worker.config.ts", "utf8");
		const turboConfig = readFileSync("turbo.json", "utf8");

		expect(workerConfig).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(workerConfig).toContain("pnpm run build:worker &&");
		expect(workerConfig).toContain("pnpm exec wrangler dev --config dist/campus_web/wrangler.json");
		expect(workerConfig).toContain("--var APP_API_BASE_URL:http://127.0.0.1:27031");
		expect(workerConfig).toContain("e2e/support/app-api-stub.ts");
		expect(workerConfig).not.toContain("globalSetup");
		expect(workerConfig).not.toContain("pnpm exec vite --host");
		expect(turboConfig).toContain('"build:test"');
		expect(turboConfig).toContain('".generated/docs-content/sources/**"');
		expect(turboConfig).toContain('".wrangler/deploy/**"');
		expect(turboConfig).not.toContain("_docs-static");
	});

	it("routes affected browser regressions through the hosted browser job", () => {
		const prWorkflow = readFileSync("../../.github/workflows/pr.yml", "utf8");
		const evidence = readFileSync("../../scripts/ci/evidence.mts", "utf8");

		expect(prWorkflow).toContain("browser-checks:");
		expect(prWorkflow).toContain("needs.light.outputs.browser_profiles");
		expect(prWorkflow).toContain("Install Chromium headless shell");
		expect(prWorkflow).toContain("Upload browser failure evidence");
		expect(prWorkflow).not.toContain("OBJECT_STORE_");
		expect(prWorkflow).toContain('CAMPUS_WEB_E2E_PREBUILT: "1"');
		expect(prWorkflow).toContain("retention-days: 7");
		expect(evidence).toContain('"campus-browser-smoke"');
		expect(evidence).toContain('"campus-browser-full"');
		expect(evidence).toContain('"ops-web-browser"');
	});
});
