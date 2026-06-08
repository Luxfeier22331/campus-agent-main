import { spawnSync } from "node:child_process";

const build = spawnSync("pnpm", ["build:staging"], {
	stdio: "inherit",
});
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

const deploy = spawnSync(
	"node",
	[
		"../../scripts/run-wrangler-command.mjs",
		"deploy",
		"--env",
		"staging",
		"--config",
		"dist/campus_ops_web/wrangler.json",
	],
	{ stdio: "inherit" },
);

process.exit(deploy.status ?? 1);
