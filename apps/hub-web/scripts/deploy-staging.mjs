import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoEnvFile } from "../../../scripts/load-repo-env.mjs";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

const DEFAULT_TURNSTILE_APPEARANCE = "interaction-only";
const DEFAULT_TURNSTILE_EXECUTION = "render";
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const VALID_TURNSTILE_APPEARANCES = new Set(["always", "execute", "interaction-only"]);
const VALID_TURNSTILE_EXECUTIONS = new Set(["render", "execute"]);

loadRepoEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sentryRelease = resolveStagingSentryRelease("hub-web");
const turnstileSiteKey = process.env.STAGING_HUB_AUTH_TURNSTILE_SITE_KEY?.trim();
const turnstileAppearance = resolveTurnstileOption(
	"STAGING_HUB_AUTH_TURNSTILE_APPEARANCE",
	process.env.STAGING_HUB_AUTH_TURNSTILE_APPEARANCE,
	VALID_TURNSTILE_APPEARANCES,
	DEFAULT_TURNSTILE_APPEARANCE,
);
const turnstileExecution = resolveTurnstileOption(
	"STAGING_HUB_AUTH_TURNSTILE_EXECUTION",
	process.env.STAGING_HUB_AUTH_TURNSTILE_EXECUTION,
	VALID_TURNSTILE_EXECUTIONS,
	DEFAULT_TURNSTILE_EXECUTION,
);

function fail(message) {
	console.error(message);
	process.exit(1);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? appDir,
		env: options.env ?? process.env,
		stdio: "inherit",
	});

	if (typeof result.status === "number") {
		if (result.status !== 0) {
			process.exit(result.status);
		}
		return;
	}

	process.exit(result.error ? 1 : 0);
}

function resolveTurnstileOption(name, rawValue, validValues, defaultValue) {
	const value = rawValue?.trim();
	if (!value) {
		return defaultValue;
	}
	if (!validValues.has(value)) {
		fail(
			`${name} must be one of ${JSON.stringify(Array.from(validValues))}. Received ${JSON.stringify(value)}.`,
		);
	}
	return value;
}

if (!turnstileSiteKey) {
	fail(
		"STAGING_HUB_AUTH_TURNSTILE_SITE_KEY is required. Inject the real Turnstile sitekey admitted for hub-staging.mucwiki-edge.link before deploying.",
	);
}

if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
	fail(
		"STAGING_HUB_AUTH_TURNSTILE_SITE_KEY must not use the Cloudflare Turnstile testing sitekey for staging deploys.",
	);
}

run("pnpm", ["build:staging"]);
run("pnpm", ["deploy:verify-config:staging"]);
run(
	"pnpm",
	[
		"exec",
		"wrangler",
		"deploy",
		"--config",
		"dist/hub_web/wrangler.json",
		"--var",
		`AUTH_TURNSTILE_SITE_KEY:${turnstileSiteKey}`,
		"--var",
		`AUTH_TURNSTILE_APPEARANCE:${turnstileAppearance}`,
		"--var",
		`AUTH_TURNSTILE_EXECUTION:${turnstileExecution}`,
		"--var",
		`SENTRY_RELEASE:${sentryRelease}`,
	],
	{
		cwd: appDir,
		env: buildWranglerCommandEnv(process.env),
	},
);
