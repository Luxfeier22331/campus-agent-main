import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.CAMPUS_WEB_E2E_WORKER_PORT ?? "27016", 10);
const baseURL = `http://127.0.0.1:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
	expect: {
		timeout: 5_000,
	},
	failOnFlakyTests: isCI,
	forbidOnly: isCI,
	globalSetup: "./e2e/worker/global-setup.ts",
	outputDir: "test-results/e2e-worker",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: isCI
		? [["list"], ["html", { open: "never", outputFolder: "playwright-report/e2e-worker" }]]
		: "list",
	retries: isCI ? 1 : 0,
	testDir: "./e2e/worker",
	timeout: 30_000,
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: isCI ? "on-first-retry" : "retain-on-failure",
	},
	webServer: {
		command: `WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 CLOUDFLARE_ENV=local XDG_CONFIG_HOME=../../.wrangler-home pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
		reuseExistingServer: !isCI,
		timeout: 120_000,
		url: baseURL,
	},
	workers: 1,
});
