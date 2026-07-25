import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const localEnvPath = resolve(appDir, ".env.local");
const baseEnvPath = resolve(appDir, ".env");
const localDevVarsPath = resolve(appDir, ".dev.vars.local");
const baseDevVarsPath = resolve(appDir, ".dev.vars");

for (const path of [localEnvPath, baseEnvPath, localDevVarsPath, baseDevVarsPath]) {
	loadEnvFileIfPresent(path);
}

const schemaDatabaseUrl = process.env.APP_API_SCHEMA_DATABASE_URL?.trim();
if (schemaDatabaseUrl) {
	process.env.APP_API_SCHEMA_DATABASE_URL = schemaDatabaseUrl;
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

function loadEnvFileIfPresent(path) {
	let content = "";
	try {
		content = readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	}
	for (const [key, value] of Object.entries(parseEnv(content))) {
		if (key && shouldSetEnv(key)) {
			process.env[key] = value;
		}
	}
}

function shouldSetEnv(key) {
	const existing = process.env[key]?.trim() || "";
	return !existing || existing.startsWith("replace-with-");
}
