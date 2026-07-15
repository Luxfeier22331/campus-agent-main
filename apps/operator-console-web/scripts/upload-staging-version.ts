import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";
import { resolveStagingSentryRelease } from "../../../scripts/deploy/staging-release.ts";
import { uploadStagingWorkerVersion } from "../../../scripts/deploy/worker-version.ts";

const PLACEHOLDER_ACCESS_POLICY_AUD = "panel-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";

function normalizeAccessTeamDomain(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		throw new Error("STAGING_ACCESS_TEAM_DOMAIN is required.");
	}
	const parsed = new URL(trimmed);
	if (parsed.protocol !== "https:") {
		throw new Error("STAGING_ACCESS_TEAM_DOMAIN must start with https://");
	}
	parsed.pathname = "";
	parsed.search = "";
	parsed.hash = "";
	const normalized = parsed.toString().replace(/\/$/, "");
	if (normalized === PLACEHOLDER_ACCESS_TEAM_DOMAIN) {
		throw new Error("STAGING_ACCESS_TEAM_DOMAIN must not use the placeholder domain.");
	}
	return normalized;
}

function normalizeAccessPolicyAud(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed || trimmed === PLACEHOLDER_ACCESS_POLICY_AUD) {
		throw new Error("STAGING_ACCESS_POLICY_AUD must contain the live Access audience.");
	}
	return trimmed;
}

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflight = spawnSync("pnpm", ["exec", "tsx", "./scripts/preflight-staging.ts"], {
	cwd: appDir,
	env: process.env,
	stdio: "inherit",
});
if (preflight.status !== 0) {
	process.exit(preflight.status ?? 1);
}

uploadStagingWorkerVersion({
	appName: "operator-console-web",
	config: "dist/operator_console_web/wrangler.json",
	cwd: appDir,
	workerName: "operator-console-web-staging",
	variables: {
		ACCESS_POLICY_AUD: normalizeAccessPolicyAud(process.env.STAGING_ACCESS_POLICY_AUD),
		ACCESS_TEAM_DOMAIN: normalizeAccessTeamDomain(process.env.STAGING_ACCESS_TEAM_DOMAIN),
		SENTRY_RELEASE: resolveStagingSentryRelease("operator-console-web"),
	},
});
