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

	it("keeps tagged browser smoke separate from Node checks and required for Campus Web", () => {
		const workflow = readFileSync("../../.github/workflows/pr.yml", "utf8");
		const affectedCheck = readFileSync("../../scripts/ci/run-affected.sh", "utf8");
		const codeJob = workflow.slice(workflow.indexOf("\n  code:"), workflow.indexOf("\n  native:"));
		const browserJob = workflow.slice(
			workflow.indexOf("\n  ui-smoke:"),
			workflow.indexOf("\n  required:"),
		);
		const requiredJob = workflow.slice(workflow.indexOf("\n  required:"));

		expect(codeJob).toContain("Run affected Worker checks");
		expect(codeJob).not.toContain("playwright");
		expect(browserJob).toContain('CAMPUS_WEB_E2E_PREBUILT: "1"');
		expect(browserJob).toContain('CAMPUS_WEB_E2E_DOCS_PREBUILT: "1"');
		expect(browserJob).toContain("turbo run build:docs:fixture");
		expect(browserJob).toContain("test:e2e:smoke:app");
		expect(browserJob).toContain("test:e2e:smoke:worker");
		expect(browserJob).toContain("continue-on-error: true");
		expect(browserJob).toContain("actions/upload-artifact@");
		expect(browserJob).toContain("retention-days: 7");
		expect(requiredJob).toContain("ui-smoke");
		expect(requiredJob).toContain("UI_SMOKE_RESULT");
		expect(affectedCheck).toContain("CI=1");
		expect(affectedCheck).toContain("CAMPUS_WEB_E2E_DOCS_PREBUILT=1");
		expect(affectedCheck).toMatch(/CAMPUS_WEB_E2E_PORT=.*27114/u);
	});
});
