import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadRepoStagingEnvFile } from "../../../scripts/load-repo-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");

loadRepoStagingEnvFile(import.meta.url, "../../..");

function fail(message) {
	console.error(message);
	process.exit(1);
}

function readRequiredEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		fail(`${name} is required.`);
	}
	return value;
}

process.env.APP_API_OPERATOR_DATABASE_URL = readRequiredEnv(
	"STAGING_APP_API_OPERATOR_DATABASE_URL",
);
process.env.APP_API_ENVIRONMENT = "staging";
process.env.AUTH_SHELL_ORIGIN =
	process.env.AUTH_SHELL_ORIGIN?.trim() || "https://campus-staging.mucwiki-edge.link";

const sslMode = process.env.STAGING_APP_API_DATABASE_SSLMODE?.trim();
if (sslMode) {
	process.env.APP_API_DATABASE_SSLMODE = sslMode;
}

readRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
readRequiredEnv("CLOUDFLARE_API_TOKEN");

const [command, ...args] = process.argv.slice(2);
if (!command) {
	fail("Usage: node ./scripts/run-with-staging-proof-env.mjs <command> [args...]");
}

const child = spawn("node", ["./scripts/run-with-staging-smoke-env.mjs", command, ...args], {
	cwd: appDir,
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
