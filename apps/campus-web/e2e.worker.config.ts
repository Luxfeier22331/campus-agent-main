import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.CAMPUS_WEB_E2E_WORKER_PORT ?? "27016", 10);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	expect: {
		timeout: 5_000,
	},
	forbidOnly: Boolean(process.env.CI),
	outputDir: "test-results/e2e-worker",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	retries: process.env.CI ? 1 : 0,
	testDir: "./e2e-worker",
	timeout: 30_000,
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: `node ./scripts/prepare-e2e-worker-docs-fixture.mjs && WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 CLOUDFLARE_ENV=local XDG_CONFIG_HOME=../../.wrangler-home pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		url: baseURL,
	},
	workers: 1,
});
