import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepoStagingEnvFile } from "./load-repo-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

loadRepoStagingEnvFile(import.meta.url, "..");

function fail(message) {
	console.error(message);
	process.exit(1);
}

function run(command, args) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		cwd: repoRoot,
		env: process.env,
	});

	if (typeof result.status === "number" && result.status !== 0) {
		process.exit(result.status);
	}

	if (result.error) {
		fail(`Failed to run ${command}: ${result.error.message}`);
	}
}

function parseArgs(argv) {
	let appPath = null;

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--app") {
			appPath = argv[index + 1] ?? null;
			index += 1;
		}
	}

	if (!appPath) {
		fail(
			"Usage: node scripts/run-worker-staging-preflight.mjs --app <apps/app-api|apps/campus-web|apps/operator-console-web>",
		);
	}

	return { appPath };
}

const APP_PREFLIGHTS = {
	"apps/app-api": {
		doctorSurface: "worker-staging-app-api",
		commands: [
			[
				"uv",
				[
					"run",
					"--all-packages",
					"python",
					"-m",
					"scripts.check_worker_secret_presence",
					"--app",
					"apps/app-api",
					"--env",
					"staging",
				],
			],
			["node", ["apps/app-api/scripts/verify-staging-config.mjs"]],
		],
	},
	"apps/campus-web": {
		doctorSurface: "worker-staging-campus-web",
		commands: [
			[
				"uv",
				[
					"run",
					"--all-packages",
					"python",
					"-m",
					"scripts.check_worker_secret_presence",
					"--app",
					"apps/campus-web",
					"--env",
					"staging",
				],
			],
			["node", ["apps/campus-web/scripts/verify-staging-config.mjs"]],
			[
				"node",
				[
					"scripts/verify-worker-deploy-config.mjs",
					"apps/campus-web/dist/campus_web/wrangler.json",
					"SERVICE:APP_API=app-api-staging",
					"VAR:APP_API_BASE_URL=https://app-api.internal",
					"VAR:CAMPUS_WEB_HOSTNAME=campus-staging.mucwiki-edge.link",
					"VAR:SENTRY_ENVIRONMENT=staging",
					"VAR_ABSENT:AUTH_TURNSTILE_SITE_KEY",
					"VAR_ABSENT:SENTRY_RELEASE",
					"ROUTE:campus-staging.mucwiki-edge.link",
				],
			],
		],
	},
	"apps/operator-console-web": {
		doctorSurface: "worker-staging-operator-console-web",
		commands: [
			[
				"uv",
				[
					"run",
					"--all-packages",
					"python",
					"-m",
					"scripts.check_worker_secret_presence",
					"--app",
					"apps/operator-console-web",
					"--env",
					"staging",
				],
			],
			[
				"node",
				[
					"scripts/verify-worker-deploy-config.mjs",
					"apps/operator-console-web/dist/operator_console_web/wrangler.json",
					"SERVICE:APP_API=app-api-staging",
					"VAR:OPERATOR_CONSOLE_APP_API_BASE_URL=https://app-api.internal",
					"VAR:SENTRY_ENVIRONMENT=staging",
					"VAR_ABSENT:SENTRY_RELEASE",
					"ROUTE:panel-staging.mucwiki-edge.link",
				],
			],
		],
	},
};

async function main() {
	const { appPath } = parseArgs(process.argv.slice(2));
	const preflight = APP_PREFLIGHTS[appPath];
	if (!preflight) {
		fail(`Unsupported app path ${appPath}.`);
	}

	run("uv", [
		"run",
		"--all-packages",
		"python",
		"-m",
		"scripts.doctor_env",
		preflight.doctorSurface,
		"--json",
	]);

	for (const [command, args] of preflight.commands) {
		run(command, args);
	}
}

await main();
