import { spawn } from "node:child_process";
import process from "node:process";

import { loadRepoStagingEnvFile } from "../../../../scripts/deploy/lib/repo-env.ts";

loadRepoStagingEnvFile(import.meta.url, "../../../..");

const REQUIRED_MAPPINGS: Array<readonly [string, string]> = [
	["STAGING_APP_API_OPERATOR_DATABASE_URL", "APP_API_OPERATOR_DATABASE_URL"],
	["STAGING_INGESTION_OBJECT_STORE_ENDPOINT", "OBJECT_STORE_ENDPOINT"],
	["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
	["STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_ACCESS_KEY"],
	["STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY"],
];

const OPTIONAL_MAPPINGS: Array<readonly [string, string]> = [
	["STAGING_INGESTION_OBJECT_STORE_REGION", "OBJECT_STORE_REGION"],
];

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		fail(`${name} is required.`);
	}
	return value;
}

for (const [source, target] of REQUIRED_MAPPINGS) {
	process.env[target] = requiredEnv(source);
}

for (const [source, target] of OPTIONAL_MAPPINGS) {
	const value = process.env[source]?.trim();
	if (value) {
		process.env[target] = value;
	}
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
	fail(
		"Usage: pnpm exec tsx ./src/docs-reader-build/run-with-staging-ingestion-env.ts <command> [args...]",
	);
}

const child = spawn(command, args, {
	cwd: process.cwd(),
	env: process.env,
	shell: process.platform === "win32",
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
