import { defineConfig, devices } from "@playwright/test";

const browserTestPort = Number(process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178");

const browserTestUrls = {
	desktop1440: `http://127.0.0.1:${browserTestPort + 2}`,
	mobile320: `http://127.0.0.1:${browserTestPort}`,
	mobile390: `http://127.0.0.1:${browserTestPort + 1}`,
} as const;

export default defineConfig({
	failOnFlakyTests: Boolean(process.env.CI),
	fullyParallel: false,
	projects: [
		{
			name: "mobile-320",
			use: {
				...devices["Desktop Chrome"],
				baseURL: browserTestUrls.mobile320,
				viewport: { height: 740, width: 320 },
			},
		},
		{
			name: "mobile-390",
			use: {
				...devices["Desktop Chrome"],
				baseURL: browserTestUrls.mobile390,
				viewport: { height: 844, width: 390 },
			},
		},
		{
			name: "desktop-1440",
			use: {
				...devices["Desktop Chrome"],
				baseURL: browserTestUrls.desktop1440,
				viewport: { height: 900, width: 1440 },
			},
		},
	],
	reporter: process.env.CI
		? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
		: "list",
	retries: process.env.CI ? 1 : 0,
	testDir: "./test/browser",
	timeout: 60_000,
	workers: 2,
	use: {
		screenshot: "only-on-failure",
		trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
		video: "off",
	},
	webServer: Object.values(browserTestUrls).map((url) => {
		const port = new URL(url).port;
		return {
			command: `OPS_WEB_BROWSER_TEST_PORT=${port} pnpm exec tsx test/browser-server.ts`,
			reuseExistingServer: false,
			timeout: 120_000,
			url: `${url}/healthz`,
		};
	}),
});
