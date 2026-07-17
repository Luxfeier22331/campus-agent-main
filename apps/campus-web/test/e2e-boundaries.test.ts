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

	it("builds the same credential-free Rspress reader fixture for Worker browser tests", () => {
		const globalSetup = readFileSync("e2e/worker/global-setup.ts", "utf8");

		expect(globalSetup).toContain('"build:docs:fixture"');
		expect(globalSetup).not.toContain("prepare-docs-fixture");
	});

	it("keeps tagged browser smoke separate from Node checks and required for Campus Web", () => {
		const workflow = readFileSync("../../.github/workflows/pr.yml", "utf8");
		const nodeJob = workflow.slice(
			workflow.indexOf("\n  node:"),
			workflow.indexOf("\n  browser-smoke:"),
		);
		const browserJob = workflow.slice(
			workflow.indexOf("\n  browser-smoke:"),
			workflow.indexOf("\n  app-api-migration:"),
		);
		const requiredJob = workflow.slice(workflow.indexOf("\n  required:"));
		const requiredResultExpression = [
			String.fromCharCode(36),
			"{{ needs.browser-smoke.result }}",
		].join("");

		expect(nodeJob).toContain("needs.changes.outputs.worker_campus_web == 'true'");
		expect(nodeJob).not.toContain("playwright");
		expect(browserJob).toContain("CAMPUS_WEB_E2E_PREBUILT: '1'");
		expect(browserJob).toContain("test:e2e:smoke:app");
		expect(browserJob).toContain("test:e2e:smoke:worker");
		expect(browserJob).toContain("continue-on-error: true");
		expect(browserJob).toContain("actions/upload-artifact@");
		expect(browserJob).toContain("retention-days: 7");
		expect(requiredJob).toContain("- browser-smoke");
		expect(requiredJob).toContain(requiredResultExpression);
	});
});
