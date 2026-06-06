import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/load-repo-env.mjs";
import { runWranglerCommand } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
	console.error(message);
	process.exit(1);
}

const upstream = process.env.STAGING_EXECUTION_GATEWAY_BASE_URL?.trim();
if (!upstream) {
	fail(
		"STAGING_EXECUTION_GATEWAY_BASE_URL is required. Point it at the mucwiki-edge staging supervisor origin before deploying staging.",
	);
}

let normalizedUpstream;
try {
	const parsed = new URL(upstream);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		fail("STAGING_EXECUTION_GATEWAY_BASE_URL must start with http:// or https://");
	}
	parsed.pathname = "";
	parsed.search = "";
	parsed.hash = "";
	normalizedUpstream = parsed.toString().replace(/\/$/, "");
} catch {
	fail("STAGING_EXECUTION_GATEWAY_BASE_URL must be a valid absolute URL.");
}

const sentryRelease = resolveStagingSentryRelease("app-api");

const result = runWranglerCommand(
	[
		"deploy",
		"--env",
		"staging",
		"--var",
		`EXECUTION_GATEWAY_BASE_URL:${normalizedUpstream}`,
		"--var",
		`SENTRY_RELEASE:${sentryRelease}`,
	],
	{ cwd: appDir, env: process.env, stdio: "inherit" },
);

if (typeof result.status === "number") {
	process.exit(result.status);
}

process.exit(result.error ? 1 : 0);
