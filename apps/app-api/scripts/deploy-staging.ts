import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";
import {
	buildWranglerCommandEnv,
	runWranglerCommand,
} from "../../../scripts/deploy/run-wrangler-command.ts";
import { resolveStagingSentryRelease } from "../../../scripts/deploy/staging-release.ts";

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runPreflight() {
	const result = spawnSync("pnpm", ["exec", "tsx", "./scripts/preflight-staging.ts"], {
		cwd: appDir,
		env: process.env,
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
