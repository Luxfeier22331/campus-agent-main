import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.CAMPUS_WEB_E2E_WORKER_PORT ?? "27016", 10);
const baseURL = `http://127.0.0.1:${port}`;
const appApiURL = "http://127.0.0.1:27031";
const isCI = Boolean(process.env.CI);
const usePrebuiltApp = process.env.CAMPUS_WEB_E2E_PREBUILT === "1";

export default defineConfig({
	expect: {
		timeout: 5_000,
	},
	failOnFlakyTests: isCI,
	forbidOnly: isCI,
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
	webServer: [
		{
			command: "pnpm exec tsx e2e/support/app-api-stub.ts",
			reuseExistingServer: !isCI,
			timeout: 30_000,
			url: `${appApiURL}/healthz`,
		},
		{
			command: `${usePrebuiltApp ? "" : "CLOUDFLARE_ENV=local pnpm run build:test && "}WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 XDG_CONFIG_HOME=../../.wrangler-home pnpm exec wrangler dev --config dist/campus_web/wrangler.json --local --ip 127.0.0.1 --port ${port} --var APP_API_BASE_URL:http://127.0.0.1:27031`,
			reuseExistingServer: !isCI,
			timeout: 120_000,
			url: baseURL,
		},
	],
	workers: 1,
});
