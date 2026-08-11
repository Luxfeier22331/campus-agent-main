import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function requireHttpsOrigin(name: string): void {
	const value = process.env[name]?.trim();
	if (!value) {
		fail(`${name} is required for apps/campus-web staging preflight.`);
	}
	let origin: URL;
	try {
		origin = new URL(value);
	} catch {
		fail(`${name} must be a valid HTTPS origin.`);
	}
	if (
		origin.protocol !== "https:" ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password
	) {
		fail(`${name} must contain only an HTTPS origin.`);
	}
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

requireHttpsOrigin("STATUS_WEB_PUBLIC_ORIGIN");
run("pnpm", ["exec", "tsx", "apps/campus-web/scripts/verify-staging-config.ts"]);
run("pnpm", [
	"exec",
	"tsx",
	"scripts/deploy/verify-worker-deploy-config.ts",
	"apps/campus-web/dist/campus_web/wrangler.json",
	"SERVICE:APP_API=app-api-staging",
	"VAR:APP_API_BASE_URL=https://app-api.internal",
	"VAR:DEPLOYMENT_ENVIRONMENT=staging",
	"VAR_ABSENT:AUTH_TURNSTILE_SITE_KEY",
	"VAR_ABSENT:DEPLOYMENT_RELEASE",
]);
