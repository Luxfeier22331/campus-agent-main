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

async function probeUrl(input) {
	const response = await fetch(input.url, {
		headers: {
			accept: "application/json",
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const body = (await response.text()).trim();
		const detail = body ? ` body=${JSON.stringify(body.slice(0, 200))}` : "";
		fail(`${input.label} returned HTTP ${response.status}.${detail}`);
	}
}

async function probeSupervisorApiForStagingAppApi() {
	const upstream = process.env.STAGING_EXECUTION_CONTROL_BASE_URL?.trim();
	if (!upstream) {
		fail("STAGING_EXECUTION_CONTROL_BASE_URL is required for apps/app-api staging preflight.");
	}

	let baseUrl;
	try {
		baseUrl = new URL(upstream);
	} catch {
		fail("STAGING_EXECUTION_CONTROL_BASE_URL must be a valid absolute URL.");
	}

	baseUrl.pathname = "/";
	baseUrl.search = "";
	baseUrl.hash = "";

	const healthUrl = new URL("/healthz", baseUrl);

	try {
		await probeUrl({
			label: `STAGING_EXECUTION_CONTROL_BASE_URL health probe (${healthUrl.toString()})`,
			url: healthUrl,
		});
	} catch (error) {
		if (error instanceof Error) {
			fail(error.message);
		}
		fail(String(error));
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
			"Usage: node scripts/run-worker-staging-preflight.mjs --app <apps/app-api|apps/hub-web|apps/public-chat-web|apps/protected-panel-web>",
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
			["pnpm", ["--dir", "apps/app-api", "db:bootstrap:staging"]],
			["pnpm", ["--dir", "apps/app-api", "db:migrate:staging"]],
			["pnpm", ["--dir", "apps/app-api", "db:reconcile-shared-drift:staging", "--", "--json"]],
		],
	},
	"apps/hub-web": {
		doctorSurface: "worker-staging-hub-web",
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
					"apps/hub-web",
					"--env",
					"staging",
				],
			],
			["pnpm", ["--dir", "apps/hub-web", "build:staging"]],
			["pnpm", ["--dir", "apps/hub-web", "deploy:verify-config:staging"]],
		],
	},
	"apps/public-chat-web": {
		doctorSurface: "worker-staging-public-chat-web",
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
					"apps/public-chat-web",
					"--env",
					"staging",
				],
			],
			["pnpm", ["--dir", "apps/public-chat-web", "build:staging"]],
			["pnpm", ["--dir", "apps/public-chat-web", "deploy:verify-config:staging"]],
		],
	},
	"apps/protected-panel-web": {
		doctorSurface: "worker-staging-protected-panel-web",
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
					"apps/protected-panel-web",
					"--env",
					"staging",
				],
			],
			["pnpm", ["--dir", "apps/protected-panel-web", "build:staging"]],
			["pnpm", ["--dir", "apps/protected-panel-web", "deploy:verify-config:staging"]],
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

	if (appPath === "apps/app-api") {
		await probeSupervisorApiForStagingAppApi();
	}

	for (const [command, args] of preflight.commands) {
		run(command, args);
	}
}

await main();
