import { spawnSync } from "node:child_process";
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

function runPreflight() {
	const result = spawnSync(
		"node",
		["../../scripts/run-worker-staging-preflight.mjs", "--app", "apps/app-api"],
		{
			cwd: appDir,
			env: process.env,
			stdio: "inherit",
		},
	);
	if (typeof result.status === "number") {
		if (result.status !== 0) {
			process.exit(result.status);
		}
		return;
	}
	process.exit(result.error ? 1 : 0);
}

const sentryRelease = resolveStagingSentryRelease("app-api");

runPreflight();

const result = runWranglerCommand(
	["deploy", "--env", "staging", "--var", `SENTRY_RELEASE:${sentryRelease}`],
	{ cwd: appDir, env: buildWranglerCommandEnv(process.env), stdio: "inherit" },
);

if (typeof result.status === "number") {
	process.exit(result.status);
}

process.exit(result.error ? 1 : 0);
