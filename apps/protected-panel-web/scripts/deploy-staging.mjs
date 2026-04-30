import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoEnvFile } from "../../../scripts/load-repo-env.mjs";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

const PLACEHOLDER_ACCESS_POLICY_AUD = "panel-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";

loadRepoEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function normalizeAccessTeamDomain(value) {
	const trimmed = value?.trim();
	if (!trimmed) {
		fail(
			"STAGING_ACCESS_TEAM_DOMAIN is required. Inject the real Cloudflare Access team domain for panel staging before deploy.",
		);
	}

	let normalized;
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "https:") {
			fail("STAGING_ACCESS_TEAM_DOMAIN must start with https://");
		}
		parsed.pathname = "";
		parsed.search = "";
		parsed.hash = "";
		normalized = parsed.toString().replace(/\/$/, "");
	} catch {
		fail("STAGING_ACCESS_TEAM_DOMAIN must be a valid absolute URL.");
	}

	if (normalized === PLACEHOLDER_ACCESS_TEAM_DOMAIN) {
		fail("STAGING_ACCESS_TEAM_DOMAIN must not use the placeholder Cloudflare Access team domain.");
	}

	return normalized;
}

function normalizeAccessPolicyAud(value) {
	const trimmed = value?.trim();
	if (!trimmed) {
		fail(
			"STAGING_ACCESS_POLICY_AUD is required. Inject the real Cloudflare Access application audience for panel staging before deploy.",
		);
	}
	if (trimmed === PLACEHOLDER_ACCESS_POLICY_AUD) {
		fail("STAGING_ACCESS_POLICY_AUD must not use the placeholder Access audience.");
	}

	return trimmed;
}

const accessTeamDomain = normalizeAccessTeamDomain(process.env.STAGING_ACCESS_TEAM_DOMAIN);
const accessPolicyAud = normalizeAccessPolicyAud(process.env.STAGING_ACCESS_POLICY_AUD);
const sentryRelease = resolveStagingSentryRelease("protected-panel-web");

// Always rebuild before deploy so staging cannot reuse a stale dist bundle.
run("pnpm", ["build:staging"]);
run("pnpm", ["deploy:verify-config:staging"]);
run(
	"wrangler",
	[
		"deploy",
		"--config",
		"dist/protected_panel_web/wrangler.json",
		"--var",
		`ACCESS_TEAM_DOMAIN:${accessTeamDomain}`,
		"--var",
		`ACCESS_POLICY_AUD:${accessPolicyAud}`,
		"--var",
		`SENTRY_RELEASE:${sentryRelease}`,
	],
	{
		cwd: appDir,
		env: buildWranglerCommandEnv(process.env),
	},
);
