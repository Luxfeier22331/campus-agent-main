import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY_STAGING_CONFIG_TIMEOUT_MS = 15_000;

let tempRoots: string[] = [];

afterEach(() => {
	for (const tempRoot of tempRoots) {
		rmSync(tempRoot, { force: true, recursive: true });
	}
	tempRoots = [];
});

function createBuiltConfigFixture(vars: Record<string, string>) {
	const tempRoot = mkdtempSync(join(tmpdir(), "hub-web-staging-config-"));
	tempRoots.push(tempRoot);
	const configPath = join(tempRoot, "dist", "hub_web", "wrangler.json");
	mkdirSync(join(tempRoot, "dist", "hub_web"), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({
			routes: [{ custom_domain: true, pattern: "hub-staging.mucwiki-edge.link" }],
			services: [{ binding: "APP_API", service: "app-api-staging" }],
			vars,
		}),
		"utf8",
	);

	return { configPath, tempRoot };
}

describe("hub staging scripts", () => {
	it("exposes a staging-only account browser smoke command", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));

		expect(packageJson.scripts["account:smoke:staging"]).toBe(
			"node ../../scripts/run-with-staging-smoke-env.mjs --cwd apps/hub-web node ./scripts/staging-account-browser-smoke.mjs",
		);
		expect(packageJson.scripts["account:smoke:staging"]).not.toContain("dev:live-smoke");
		expect(packageJson.scripts["account:smoke:staging"]).not.toContain("localhost");
		expect(packageJson.scripts["account:smoke:staging"]).not.toContain("127.0.0.1");
	});

	it("rejects local targets for the staging account browser smoke", () => {
		const scriptSource = readFileSync(
			join(appDir, "scripts", "staging-account-browser-smoke.mjs"),
			"utf8",
		);
		const tempRoot = mkdtempSync(join(tmpdir(), "hub-web-account-browser-smoke-"));
		tempRoots.push(tempRoot);
		const scriptPath = join(tempRoot, "scripts", "staging-account-browser-smoke.mjs");
		mkdirSync(join(tempRoot, "scripts"), { recursive: true });
		writeFileSync(scriptPath, scriptSource, "utf8");

		const result = spawnSync(
			process.execPath,
			[
				scriptPath,
				"--hub-base-url",
				"http://127.0.0.1:27012",
				"--smoke-auth-secret",
				"smoke-secret",
			],
			{
				cwd: tempRoot,
				env: process.env,
				encoding: "utf8",
				timeout: VERIFY_STAGING_CONFIG_TIMEOUT_MS,
			},
		);

		expect(result.status).toBe(1);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toContain("staging smoke requires https://hub-staging.mucwiki-edge.link");
	});

	it("keeps completed browser smoke events available for failure summaries", () => {
		const scriptSource = readFileSync(
			join(appDir, "scripts", "staging-account-browser-smoke.mjs"),
			"utf8",
		);

		expect(scriptSource).toContain("export function writeSummary");
		expect(scriptSource).toContain("error.completedEvents = events");
		expect(scriptSource).toContain("Array.isArray(error.completedEvents)");
		expect(scriptSource).toContain("events,");
	});

	it("requires a real hub-scoped Turnstile sitekey for staging config verification", () => {
		const { tempRoot } = createBuiltConfigFixture({
			APP_API_BASE_URL: "https://app-api.internal",
			HUB_WEB_HOSTNAME: "hub-staging.mucwiki-edge.link",
			SENTRY_ENVIRONMENT: "staging",
		});
		const scriptSource = readFileSync(join(appDir, "scripts", "verify-staging-config.mjs"), "utf8");
		const scriptPath = join(tempRoot, "scripts", "verify-staging-config.mjs");
		mkdirSync(join(tempRoot, "scripts"), { recursive: true });
		writeFileSync(scriptPath, scriptSource, "utf8");

		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: tempRoot,
			env: {
				...process.env,
				STAGING_HUB_AUTH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
			},
			encoding: "utf8",
			timeout: VERIFY_STAGING_CONFIG_TIMEOUT_MS,
		});

		expect(result.status).toBe(1);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toContain("must not use the Cloudflare Turnstile testing sitekey");
	});

	it("accepts a built staging config with runtime-only Turnstile variables", () => {
		const { tempRoot } = createBuiltConfigFixture({
			APP_API_BASE_URL: "https://app-api.internal",
			HUB_WEB_HOSTNAME: "hub-staging.mucwiki-edge.link",
			SENTRY_ENVIRONMENT: "staging",
		});
		const scriptSource = readFileSync(join(appDir, "scripts", "verify-staging-config.mjs"), "utf8");
		const scriptPath = join(tempRoot, "scripts", "verify-staging-config.mjs");
		mkdirSync(join(tempRoot, "scripts"), { recursive: true });
		writeFileSync(scriptPath, scriptSource, "utf8");

		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: tempRoot,
			env: {
				...process.env,
				STAGING_HUB_AUTH_TURNSTILE_SITE_KEY: "0x4AAAAAAAstagingWidget",
			},
			encoding: "utf8",
			timeout: VERIFY_STAGING_CONFIG_TIMEOUT_MS,
		});

		expect(result.status).toBe(0);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
	});

	it("rejects a staging route that is not a custom domain", () => {
		const { tempRoot } = createBuiltConfigFixture({
			APP_API_BASE_URL: "https://app-api.internal",
			HUB_WEB_HOSTNAME: "hub-staging.mucwiki-edge.link",
			SENTRY_ENVIRONMENT: "staging",
		});
		const configPath = join(tempRoot, "dist", "hub_web", "wrangler.json");
		const builtConfig = JSON.parse(readFileSync(configPath, "utf8"));
		builtConfig.routes = [{ pattern: "hub-staging.mucwiki-edge.link" }];
		writeFileSync(configPath, JSON.stringify(builtConfig), "utf8");
		const scriptSource = readFileSync(join(appDir, "scripts", "verify-staging-config.mjs"), "utf8");
		const scriptPath = join(tempRoot, "scripts", "verify-staging-config.mjs");
		mkdirSync(join(tempRoot, "scripts"), { recursive: true });
		writeFileSync(scriptPath, scriptSource, "utf8");

		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: tempRoot,
			env: {
				...process.env,
				STAGING_HUB_AUTH_TURNSTILE_SITE_KEY: "0x4AAAAAAAstagingWidget",
			},
			encoding: "utf8",
			timeout: VERIFY_STAGING_CONFIG_TIMEOUT_MS,
		});

		expect(result.status).toBe(1);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toContain("custom domain route");
	});
});
