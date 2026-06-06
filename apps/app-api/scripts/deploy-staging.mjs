import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/load-repo-env.mjs";
import {
	buildWranglerCommandEnv,
	runWranglerCommand,
} from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
	console.error(message);
	process.exit(1);
}

const upstream = process.env.STAGING_EXECUTION_CONTROL_BASE_URL?.trim();
if (!upstream) {
	fail(
		"STAGING_EXECUTION_CONTROL_BASE_URL is required. Point it at the execution-control trusted machine ingress before deploying staging.",
	);
}

const accessClientId = process.env.STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID?.trim();
if (!accessClientId) {
	fail("STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID is required for execution-control trusted machine ingress.");
}

const accessClientSecret = process.env.STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET?.trim();
if (!accessClientSecret) {
	fail(
		"STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET is required for execution-control trusted machine ingress.",
	);
}

let normalizedUpstream;
try {
	const parsed = new URL(upstream);
	if (parsed.protocol !== "https:") {
		fail("STAGING_EXECUTION_CONTROL_BASE_URL must start with https://");
	}
	if (parsed.hostname !== "execution-control-staging.internal.mucwiki-edge.link") {
		fail(
			"STAGING_EXECUTION_CONTROL_BASE_URL must point at execution-control-staging.internal.mucwiki-edge.link.",
		);
	}
	parsed.pathname = "";
	parsed.search = "";
	parsed.hash = "";
	normalizedUpstream = parsed.toString().replace(/\/$/, "");
} catch {
	fail("STAGING_EXECUTION_CONTROL_BASE_URL must be a valid absolute URL.");
}

const sentryRelease = resolveStagingSentryRelease("app-api");

const result = runWranglerCommand(
	[
		"deploy",
		"--env",
		"staging",
		"--var",
		`EXECUTION_CONTROL_BASE_URL:${normalizedUpstream}`,
		"--var",
		`SENTRY_RELEASE:${sentryRelease}`,
	],
	{ cwd: appDir, env: buildWranglerCommandEnv(process.env), stdio: "inherit" },
);

if (typeof result.status === "number") {
	process.exit(result.status);
}

process.exit(result.error ? 1 : 0);
