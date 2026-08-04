import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.CAMPUS_WEB_E2E_PORT ?? "27014", 10);
const baseURL = `http://127.0.0.1:${port}`;
const isCI = Boolean(process.env.CI);
const usePrebuiltApp = process.env.CAMPUS_WEB_E2E_PREBUILT === "1";

export default defineConfig({
	expect: {
		timeout: 5_000,
	},
	failOnFlakyTests: isCI,
	forbidOnly: isCI,
	outputDir: "test-results/e2e",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: isCI
		? [["list"], ["html", { open: "never", outputFolder: "playwright-report/e2e" }]]
		: "list",
	retries: isCI ? 1 : 0,
	testDir: "./e2e",
	testIgnore: ["worker/**"],
	timeout: 30_000,
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: `${usePrebuiltApp ? "" : "pnpm run build:test && "}WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 XDG_CONFIG_HOME=../../.wrangler-home pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
		reuseExistingServer: !isCI,
		timeout: 120_000,
		url: baseURL,
	},
	workers: 1,
});
