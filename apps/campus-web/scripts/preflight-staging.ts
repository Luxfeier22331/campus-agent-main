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
	"worker-staging-campus-web",
	"--",
	"pnpm",
	"exec",
	"tsx",
	"scripts/deploy/check-worker-secret-presence.ts",
	"--app",
	"apps/campus-web",
	"--env",
	"staging",
]);
run("pnpm", ["exec", "tsx", "apps/campus-web/scripts/verify-staging-config.ts"]);
run("pnpm", [
	"exec",
	"tsx",
	"scripts/deploy/verify-worker-deploy-config.ts",
	"apps/campus-web/dist/campus_web/wrangler.json",
	"SERVICE:APP_API=app-api-staging",
	"VAR:APP_API_BASE_URL=https://app-api.internal",
	"VAR:CAMPUS_WEB_HOSTNAME=campus-staging.mucwiki-edge.link",
	"VAR:SENTRY_ENVIRONMENT=staging",
	"VAR_ABSENT:AUTH_TURNSTILE_SITE_KEY",
	"VAR_ABSENT:SENTRY_RELEASE",
	"ROUTE:campus-staging.mucwiki-edge.link",
]);
