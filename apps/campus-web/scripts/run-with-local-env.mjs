import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadRepoEnvFile } from "../../../scripts/load-repo-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "../..");

loadRepoEnvFile(import.meta.url, "../../..");
try {
	process.loadEnvFile(resolve(appDir, ".env"));
} catch (error) {
	if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
		throw error;
	}
}

Object.assign(process.env, loadProjectedLocalRuntimeEnv());

const [command, ...args] = process.argv.slice(2);
if (!command) {
	console.error("Usage: node ./scripts/run-with-local-env.mjs <command> [args...]");
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

function loadProjectedLocalRuntimeEnv() {
	const result = spawnSync(
		process.execPath,
		[
			resolve(repoRoot, "infra/local/scripts/project-local-runtime-env.mjs"),
			"--repo-root",
			repoRoot,
			"--skip-hindsight-provider-config",
			"--target",
			"host",
			"--format",
			"env",
		],
		{
			cwd: repoRoot,
			env: process.env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
		},
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
	return parseProjectedEnv(result.stdout ?? "");
}

function parseProjectedEnv(output) {
	const projected = {};
	const parts = output.split("\0");
	for (let index = 0; index < parts.length - 1; index += 2) {
		const key = parts[index]?.trim();
		const value = parts[index + 1];
		if (key) {
			projected[key] = value;
		}
	}
	return projected;
}
