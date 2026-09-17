import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("campus web browser test boundaries", () => {
	it("keeps worker specs out of the SPA project and supports a prebuilt app", () => {
		const config = readFileSync("e2e.config.ts", "utf8");
		const uiBaselineConfig = readFileSync("e2e.ui-baseline.config.ts", "utf8");

		expect(config).toContain('testIgnore: ["worker/**", "ui-baseline.spec.ts"]');
		expect(config).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(config).toContain("pnpm run build:test");
		expect(config).toContain('trace: "retain-on-failure"');
		expect(config).toContain("vite preview");
		expect(config).not.toContain("vite --host");
		expect(config).toContain("failOnFlakyTests: isCI");
		expect(config).toContain("reuseExistingServer: false");
		expect(uiBaselineConfig).toContain("reuseExistingServer: false");
	});

	it("uses the same prebuilt test Worker for browser boundaries", () => {
		const workerConfig = readFileSync("e2e.worker.config.ts", "utf8");
		const turboConfig = readFileSync("turbo.json", "utf8");

		expect(workerConfig).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(workerConfig).toContain("pnpm run build:worker &&");
		expect(workerConfig).toContain("pnpm exec wrangler dev --config dist/campus_web/wrangler.json");
		expect(workerConfig).toContain("CAMPUS_WEB_E2E_APP_API_PORT");
		expect(workerConfig).toMatch(/--var APP_API_BASE_URL:\$\{appApiURL\}/u);
		expect(workerConfig).toContain("e2e/support/app-api-stub.ts");
		expect(workerConfig.match(/reuseExistingServer: false/gu)).toHaveLength(2);
		expect(workerConfig).not.toContain("globalSetup");
		expect(workerConfig).not.toContain("pnpm exec vite --host");
		expect(turboConfig).toContain('"build:test"');
		expect(turboConfig).toContain('".generated/docs-content/sources/**"');
		expect(turboConfig).toContain('".wrangler/deploy/**"');
		expect(turboConfig).not.toContain("_docs-static");
	});

	it("keeps browser regressions as local-only evidence", () => {
		const prWorkflow = readFileSync("../../.github/workflows/pr.yml", "utf8");
		const evidence = readFileSync("../../scripts/ci/evidence.mts", "utf8");

		expect(prWorkflow).not.toContain("browser-checks:");
		expect(prWorkflow).not.toContain("Install Chromium headless shell");
		expect(prWorkflow).not.toContain("Upload browser failure evidence");
		expect(prWorkflow).not.toContain("OBJECT_STORE_");
		expect(prWorkflow).not.toContain('CAMPUS_WEB_E2E_PREBUILT: "1"');
		expect(evidence).not.toContain('"campus-browser-smoke"');
		expect(evidence).not.toContain('"campus-browser-full"');
		expect(evidence).not.toContain('"ops-web-browser"');
	});
});
