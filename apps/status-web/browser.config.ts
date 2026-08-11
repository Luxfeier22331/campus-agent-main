import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.STATUS_WEB_BROWSER_TEST_PORT ?? "8788", 10);
const baseURL = `http://127.0.0.1:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
	expect: { timeout: 5_000 },
	failOnFlakyTests: isCI,
	forbidOnly: isCI,
	fullyParallel: false,
	outputDir: "test-results/browser",
	projects: [
		{
			name: "mobile-320",
			use: {
				...devices["Desktop Chrome"],
				hasTouch: true,
				viewport: { height: 740, width: 320 },
			},
		},
		{
			name: "mobile-390",
			use: {
				...devices["Desktop Chrome"],
				hasTouch: true,
				viewport: { height: 844, width: 390 },
			},
		},
		{
			name: "touch-768",
			use: {
				...devices["Desktop Chrome"],
				hasTouch: true,
				viewport: { height: 800, width: 768 },
			},
		},
		{
			name: "touch-1023",
			use: {
				...devices["Desktop Chrome"],
				hasTouch: true,
				viewport: { height: 800, width: 1023 },
			},
		},
		{
			name: "desktop-1024",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 800, width: 1024 },
			},
		},
		{
			name: "desktop-1440",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 900, width: 1440 },
			},
		},
	],
	reporter: isCI
		? [["list"], ["html", { open: "never", outputFolder: "playwright-report/browser" }]]
		: "list",
	retries: isCI ? 1 : 0,
	testDir: "./e2e",
	timeout: 30_000,
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: isCI ? "on-first-retry" : "retain-on-failure",
		video: "off",
	},
	webServer: {
		command: `WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 XDG_CONFIG_HOME=../../.wrangler-home pnpm exec wrangler dev --local --env local --ip 127.0.0.1 --port ${port}`,
		reuseExistingServer: !isCI,
		timeout: 120_000,
		url: `${baseURL}/healthz`,
	},
	workers: 1,
});
