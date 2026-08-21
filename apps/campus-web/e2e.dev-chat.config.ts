import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
import { loadLocalDevProfile } from "../../scripts/dev/profile";

const appRoot = import.meta.dirname;
const repoRoot = resolve(appRoot, "../..");
const profile = loadLocalDevProfile(repoRoot);
const appApiPort = profile.ports.appApi;
const campusWebPort = profile.ports.campusWeb;
const executionControlFixturePort = 27_051 + profile.slot * 100;
const appApiOrigin = `http://127.0.0.1:${appApiPort}`;
const campusWebOrigin = `http://127.0.0.1:${campusWebPort}`;
const executionControlFixtureOrigin = `http://127.0.0.1:${executionControlFixturePort}`;
const appApiDevVarsPath = resolve(appRoot, "../app-api/.dev.vars.local");
const appApiEnvironment = parseEnv(readFileSync(resolve(appRoot, "../app-api/.env.local"), "utf8"));
const campusWebDevVarsPath = resolve(appRoot, ".dev.vars.local");

function processEnvironment(overrides: Record<string, string>): Record<string, string> {
	return {
		...Object.fromEntries(
			Object.entries(process.env).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
		...overrides,
	};
}

export default defineConfig({
	expect: {
		timeout: 15_000,
	},
	forbidOnly: Boolean(process.env.CI),
	outputDir: "test-results/e2e-dev-chat",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: "list",
	testDir: "./e2e-dev-chat",
	timeout: 90_000,
	use: {
		baseURL: campusWebOrigin,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: [
		{
			command:
				"node --env-file-if-exists=apps/app-api/.dev.vars.local --experimental-strip-types apps/app-api/e2e/local-execution-control-fixture.ts",
			env: processEnvironment({
				APP_API_BASE_URL: appApiOrigin,
				PORT: String(executionControlFixturePort),
			}),
			reuseExistingServer: false,
			timeout: 30_000,
			url: `${executionControlFixtureOrigin}/healthz`,
			cwd: repoRoot,
		},
		{
			command: [
				"pnpm --dir apps/app-api exec wrangler dev -e local",
				"--name app-api-local --ip 127.0.0.1",
				`--port ${appApiPort} --env-file ${appApiDevVarsPath}`,
				`--var EXECUTION_CONTROL_BASE_URL:${executionControlFixtureOrigin}`,
			].join(" "),
			env: processEnvironment({
				...appApiEnvironment,
				WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
				XDG_CONFIG_HOME: resolve(repoRoot, ".wrangler-home"),
			}),
			reuseExistingServer: false,
			timeout: 120_000,
			url: `${appApiOrigin}/readyz`,
			cwd: repoRoot,
		},
		{
			command: [
				"pnpm --dir apps/campus-web exec wrangler dev",
				"--config dist/campus_web/wrangler.json --local",
				`--ip 127.0.0.1 --port ${campusWebPort}`,
				`--env-file ${campusWebDevVarsPath}`,
				"--var APP_API_BASE_URL:https://app-api.internal",
			].join(" "),
			env: processEnvironment({
				WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
				XDG_CONFIG_HOME: resolve(repoRoot, ".wrangler-home"),
			}),
			reuseExistingServer: false,
			timeout: 120_000,
			url: `${campusWebOrigin}/theme-bootstrap.js`,
			cwd: repoRoot,
		},
	],
	workers: 1,
});
