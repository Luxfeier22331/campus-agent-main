import { defineConfig, devices } from "@playwright/test";

const browserTestPort = process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178";

export default defineConfig({
	fullyParallel: false,
	projects: [
		{
			name: "mobile-320",
			use: { ...devices["Desktop Chrome"], viewport: { height: 740, width: 320 } },
		},
		{
			name: "mobile-390",
			use: { ...devices["Desktop Chrome"], viewport: { height: 844, width: 390 } },
		},
		{
			name: "desktop-1440",
			use: { ...devices["Desktop Chrome"], viewport: { height: 900, width: 1440 } },
		},
	],
	reporter: process.env.CI ? "github" : "list",
	retries: process.env.CI ? 1 : 0,
	testDir: "./test/browser",
	timeout: 30_000,
	workers: 2,
	use: {
		baseURL: `http://127.0.0.1:${browserTestPort}`,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
		video: "off",
	},
	webServer: {
		command: "pnpm build && pnpm exec tsx test/browser-server.ts",
		reuseExistingServer: false,
		timeout: 120_000,
		url: `http://127.0.0.1:${browserTestPort}/healthz`,
	},
});
