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
			...input.headers,
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const body = (await response.text()).trim();
		const detail = body ? ` body=${JSON.stringify(body.slice(0, 200))}` : "";
		fail(`${input.label} returned HTTP ${response.status}.${detail}`);
	}
}

function requireTrimmedEnv(key) {
	const value = process.env[key]?.trim();
	if (!value) {
		fail(`${key} is required for apps/app-api staging preflight.`);
	}
	return value;
}

async function probeExecutionControlForStagingAppApi() {
	const upstream = process.env.STAGING_EXECUTION_CONTROL_BASE_URL?.trim();
	if (!upstream) {
		fail("STAGING_EXECUTION_CONTROL_BASE_URL is required for apps/app-api staging preflight.");
	}
	const accessClientId = requireTrimmedEnv("STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID");
	const accessClientSecret = requireTrimmedEnv("STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET");

	let baseUrl;
	try {
		baseUrl = new URL(upstream);
	} catch {
		fail("STAGING_EXECUTION_CONTROL_BASE_URL must be a valid absolute URL.");
	}
	if (baseUrl.protocol !== "https:") {
		fail("STAGING_EXECUTION_CONTROL_BASE_URL must use https:// for machine ingress.");
	}
	if (baseUrl.hostname !== "execution-control-staging.mucwiki-edge.link") {
		fail(
			"STAGING_EXECUTION_CONTROL_BASE_URL must point at execution-control-staging.mucwiki-edge.link.",
		);
	}

	baseUrl.pathname = "/";
	baseUrl.search = "";
	baseUrl.hash = "";

	const healthUrl = new URL("/healthz", baseUrl);

	try {
		await probeUrl({
			label: `STAGING_EXECUTION_CONTROL_BASE_URL health probe (${healthUrl.toString()})`,
			url: healthUrl,
			headers: {
				"CF-Access-Client-Id": accessClientId,
				"CF-Access-Client-Secret": accessClientSecret,
			},
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
			[
				"node",
				[
					"apps/app-api/scripts/run-with-staging-db-env.mjs",
					"node",
					"./scripts/bootstrap-shared-product-with-seeds.mjs",
				],
			],
			[
				"node",
				[
					"apps/app-api/scripts/run-with-staging-db-env.mjs",
					"pnpm",
					"exec",
					"drizzle-kit",
					"migrate",
				],
			],
			[
				"node",
				[
					"apps/app-api/scripts/run-with-staging-db-env.mjs",
					"node",
					"./scripts/reconcile-shared-db-drift.mjs",
					"--json",
				],
			],
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
			["pnpm", ["--dir", "apps/campus-web", "build:staging"]],
			["node", ["apps/campus-web/scripts/verify-staging-config.mjs"]],
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
			["pnpm", ["--dir", "apps/operator-console-web", "build:staging"]],
			[
				"node",
				[
					"scripts/verify-worker-deploy-config.mjs",
					"apps/operator-console-web/dist/operator_console_web/wrangler.json",
					"SERVICE:APP_API=app-api-staging",
					"VAR:OPERATOR_CONSOLE_APP_API_BASE_URL=https://app-api.internal",
					"VAR:SENTRY_ENVIRONMENT=staging",
					"VAR_ABSENT:SENTRY_RELEASE",
					"ROUTE:operator-console-staging.mucwiki-edge.link",
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

	if (appPath === "apps/app-api") {
		await probeExecutionControlForStagingAppApi();
	}

	for (const [command, args] of preflight.commands) {
		run(command, args);
	}
}

await main();
