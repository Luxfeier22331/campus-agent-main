import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.CAMPUS_WEB_E2E_UI_BASELINE_PORT ?? "27024", 10);
const baseURL = `http://127.0.0.1:${port}`;
const isCI = Boolean(process.env.CI);
const usePrebuiltApp = process.env.CAMPUS_WEB_E2E_PREBUILT === "1";

export default defineConfig({
	expect: {
		timeout: 5_000,
	},
	failOnFlakyTests: isCI,
	forbidOnly: isCI,
	outputDir: "test-results/e2e-ui-baseline",
	projects: [
		{
			name: "mobile-320",
			grep: /@(layout)\b/u,
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 740, width: 320 },
			},
		},
		{
			name: "mobile-390",
			grep: /@(layout|interaction|mobile)\b/u,
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 844, width: 390 },
			},
		},
		{
			name: "boundary-1023",
			grep: /@(layout|breakpoint)\b/u,
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 800, width: 1023 },
			},
		},
		{
			name: "desktop-1024",
			grep: /@(layout|breakpoint)\b/u,
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 800, width: 1024 },
			},
		},
		{
			name: "desktop-1440",
			grep: /@(layout|interaction|desktop)\b/u,
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 900, width: 1440 },
			},
		},
	],
	reporter: isCI
		? [["list"], ["html", { open: "never", outputFolder: "playwright-report/e2e-ui-baseline" }]]
		: "list",
	retries: isCI ? 1 : 0,
	testDir: "./e2e",
	testMatch: /ui-baseline\.spec\.ts/u,
	timeout: 30_000,
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: isCI ? "on-first-retry" : "retain-on-failure",
	},
	webServer: {
		command: `${usePrebuiltApp ? "" : "pnpm run build:test && "}WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 XDG_CONFIG_HOME=../../.wrangler-home pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
		reuseExistingServer: false,
		timeout: 120_000,
		url: baseURL,
	},
	workers: 2,
});
