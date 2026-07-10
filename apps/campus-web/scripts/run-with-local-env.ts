import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadRepoEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");

loadRepoEnvFile(import.meta.url, "../../..");
try {
	process.loadEnvFile(resolve(appDir, ".env"));
} catch (error) {
	if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
		throw error;
	}
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
	console.error("Usage: pnpm exec tsx ./scripts/run-with-local-env.ts <command> [args...]");
	process.exit(1);
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
