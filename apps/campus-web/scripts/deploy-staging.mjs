import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoStagingEnvFile } from "../../../scripts/load-repo-env.mjs";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

loadRepoStagingEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sentryRelease = resolveStagingSentryRelease("campus-web");

const result = spawnSync(
	"pnpm",
	[
		"exec",
		"wrangler",
		"deploy",
		"--config",
		"dist/campus_web/wrangler.json",
		"--var",
		`SENTRY_RELEASE:${sentryRelease}`,
	],
	{
		cwd: appDir,
		env: buildWranglerCommandEnv(process.env),
		stdio: "inherit",
	},
);

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
