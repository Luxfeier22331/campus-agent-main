import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("campus web browser test boundaries", () => {
	it("keeps worker specs out of the SPA project and supports a prebuilt app", () => {
		const config = readFileSync("e2e.config.ts", "utf8");

		expect(config).toContain('testIgnore: ["worker/**"]');
		expect(config).toContain("CAMPUS_WEB_E2E_PREBUILT");
		expect(config).toContain("pnpm run build:app");
		expect(config).toContain("vite preview");
		expect(config).not.toContain("vite --host");
		expect(config).toContain("failOnFlakyTests: isCI");
	});

	it("builds or consumes the same credential-free Rspress reader fixture", () => {
		const globalSetup = readFileSync("e2e/worker/global-setup.ts", "utf8");
		const turboConfig = readFileSync("turbo.json", "utf8");

		expect(globalSetup).toContain('"build:docs:fixture"');
		expect(globalSetup).toContain("CAMPUS_WEB_E2E_DOCS_PREBUILT");
		expect(globalSetup).toContain('"public/_docs-static"');
		expect(globalSetup).not.toContain("prepare-docs-fixture");
		expect(turboConfig).toContain('"build:docs:fixture"');
		expect(turboConfig).toContain('"public/_docs-static/**"');
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
		expect(browserJob).toContain('CAMPUS_WEB_E2E_PREBUILT: "1"');
		expect(browserJob).toContain('CAMPUS_WEB_E2E_DOCS_PREBUILT: "1"');
		expect(browserJob).toContain("turbo run build:docs:fixture");
		expect(browserJob).toContain("test:e2e:full");
		expect(browserJob).toContain("apps/ops-web test:browser");
		expect(browserJob).toContain("actions/upload-artifact@");
		expect(browserJob).toContain("retention-days: 7");
	});
});
