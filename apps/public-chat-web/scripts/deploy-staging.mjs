import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoEnvFile } from "../../../scripts/load-repo-env.mjs";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

loadRepoEnvFile(import.meta.url, "../../..");
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sentryRelease = resolveStagingSentryRelease("public-chat-web");

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

// Always rebuild before deploy so staging cannot reuse a stale dist bundle.
run("pnpm", ["build:staging"]);
run("pnpm", ["deploy:verify-config:staging"]);
run(
	"wrangler",
	[
		"deploy",
		"--config",
		"dist/public_chat_web/wrangler.json",
		"--var",
		`SENTRY_RELEASE:${sentryRelease}`,
	],
	{
		cwd: appDir,
		env: buildWranglerCommandEnv(process.env),
	},
);
