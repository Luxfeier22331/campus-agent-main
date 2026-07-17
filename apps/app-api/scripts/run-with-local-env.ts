import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "../..");
const repoEnvPath = resolve(repoRoot, ".env");
const localEnvPath = resolve(appDir, ".env");
const localDevVarsPath = resolve(appDir, ".dev.vars");

for (const path of [repoEnvPath, localEnvPath, localDevVarsPath]) {
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
	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const separatorIndex = rawLine.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}
		const key = rawLine.slice(0, separatorIndex).trim();
		const value = rawLine.slice(separatorIndex + 1).trim();
		if (key && shouldSetEnv(key)) {
			process.env[key] = value;
		}
	}
}

function shouldSetEnv(key) {
	const existing = process.env[key]?.trim() || "";
	return !existing || existing.startsWith("replace-with-");
}
