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

const operatorDatabaseUrl = process.env.STAGING_APP_API_OPERATOR_DATABASE_URL?.trim();
if (!operatorDatabaseUrl) {
	fail("STAGING_APP_API_OPERATOR_DATABASE_URL is required.");
}

process.env.APP_API_OPERATOR_DATABASE_URL = operatorDatabaseUrl;
process.env.APP_API_ENVIRONMENT = "staging";
process.env.AUTH_SHELL_ORIGIN =
	process.env.AUTH_SHELL_ORIGIN?.trim() || "https://hub-staging.mucwiki-edge.link";
process.env.PUBLIC_CHAT_WEB_ORIGIN =
	process.env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || "https://chat-staging.mucwiki-edge.link";

const sslMode = process.env.STAGING_APP_API_DATABASE_SSLMODE?.trim();
if (sslMode) {
	process.env.APP_API_DATABASE_SSLMODE = sslMode;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
	fail("Usage: node ./scripts/run-with-staging-db-env.mjs <command> [args...]");
}

const child = spawn(command, args, {
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
