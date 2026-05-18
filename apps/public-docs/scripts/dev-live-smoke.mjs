import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "../..");
const appApiDir = resolve(repoRoot, "apps/app-api");

for (const envPath of [
	resolve(appApiDir, ".env"),
	resolve(appApiDir, ".dev.vars"),
	resolve(appDir, ".dev.vars"),
]) {
	try {
		process.loadEnvFile(envPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}
}

const child = spawn(
	process.execPath,
	[
		resolve(repoRoot, "scripts/run-wrangler-command.mjs"),
		"dev",
		"-c",
		"wrangler.local-smoke.toml",
		"-c",
		"../app-api/wrangler.local-smoke.toml",
		"--ip",
		"127.0.0.1",
		"--port",
		"27114",
	],
	{
		cwd: appDir,
		env: {
			...process.env,
			WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
			XDG_CONFIG_HOME: "./.wrangler-home",
		},
		stdio: "inherit",
	},
);

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
