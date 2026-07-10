import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";

loadRepoStagingEnvFile(import.meta.url, "../../..");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: repoRoot, env: process.env, stdio: "inherit" });
	if (typeof result.status === "number") {
		if (result.status !== 0) {
			process.exit(result.status);
		}
		return;
	}
	fail(`Failed to run ${command}: ${result.error?.message ?? "unknown error"}`);
}

run("pnpm", [
	"exec",
	"tsx",
	"scripts/deploy/run-worker-staging-preflight.ts",
	"--doctor-surface",
	"worker-staging-app-api",
	"--",
	"pnpm",
	"exec",
	"tsx",
	"scripts/deploy/check-worker-secret-presence.ts",
	"--app",
	"apps/app-api",
	"--env",
	"staging",
]);
run("pnpm", ["exec", "tsx", "apps/app-api/scripts/verify-staging-config.ts"]);
