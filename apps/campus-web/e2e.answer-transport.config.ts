import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./e2e-answer-transport",
	timeout: 180_000,
	workers: 1,
	fullyParallel: false,
	use: { headless: true, trace: "retain-on-failure" },
	reporter: "list",
	outputDir: "test-results/answer-transport",
});
