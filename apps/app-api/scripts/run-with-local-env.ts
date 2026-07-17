import { execFileSync, spawn } from "node:child_process";
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
const primaryWorktreeRoot = resolvePrimaryWorktreeRoot();

const envPaths = [repoEnvPath, localEnvPath, localDevVarsPath];
if (primaryWorktreeRoot && primaryWorktreeRoot !== repoRoot) {
	envPaths.push(
		resolve(primaryWorktreeRoot, ".env"),
		resolve(primaryWorktreeRoot, "apps/app-api/.env"),
		resolve(primaryWorktreeRoot, "apps/app-api/.dev.vars"),
	);
}

for (const path of envPaths) {
	loadEnvFileIfPresent(path);
}

applyLocalDatabaseDefaults();

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

function resolvePrimaryWorktreeRoot() {
	try {
		const gitCommonDir = execFileSync(
			"git",
			["rev-parse", "--path-format=absolute", "--git-common-dir"],
			{
				cwd: repoRoot,
				encoding: "utf8",
			},
		).trim();
		return gitCommonDir ? dirname(gitCommonDir) : null;
	} catch {
		return null;
	}
}

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

function applyLocalDatabaseDefaults() {
	const user = process.env.LOCAL_POSTGRES_USER?.trim() || "postgres";
	const password = process.env.LOCAL_POSTGRES_PASSWORD?.trim() || "postgres";
	const port = process.env.LOCAL_POSTGRES_PORT?.trim() || "5432";
	const database = process.env.LOCAL_POSTGRES_DB?.trim() || "campus_agent";
	const localUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
	const operatorUrl =
		process.env.APP_API_OPERATOR_DATABASE_URL?.trim() ||
		process.env.DATABASE_URL?.trim() ||
		localUrl;

	setDefault("APP_API_OPERATOR_DATABASE_URL", operatorUrl);
	setDefault("DATABASE_URL", operatorUrl);
	setDefault("APP_API_DATABASE_SSLMODE", "disable");
	setDefault("AUTH_SHELL_ORIGIN", "http://127.0.0.1:27014");
	setDefault("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB", operatorUrl);
	setDefault("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH", operatorUrl);
}

function setDefault(key, value) {
	if (!process.env[key]?.trim()) {
		process.env[key] = value;
	}
}
