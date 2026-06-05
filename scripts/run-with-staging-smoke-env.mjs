import { spawn } from "node:child_process";
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadRepoStagingEnvFile } from "./load-repo-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

loadRepoStagingEnvFile(import.meta.url, "..");

const parsed = parseInvocation(process.argv.slice(2));
if (!parsed.command) {
	console.error(
		"Usage: node ./scripts/run-with-staging-smoke-env.mjs [--cwd <repo-relative-dir>] <command> [args...]",
	);
	process.exit(1);
}

const stagingSmokeLockPath = resolve(
	repoRoot,
	process.env.STAGING_SMOKE_LOCK_PATH?.trim() || ".tmp/staging-smoke.lock",
);
const stagingSmokeLockWaitMs = positiveIntegerEnv("STAGING_SMOKE_LOCK_WAIT_MS", 300_000);
const stagingSmokeLockStaleMs = positiveIntegerEnv("STAGING_SMOKE_LOCK_STALE_MS", 1_800_000);

let stagingSmokeLockFd = null;
let child = null;
let shuttingDown = false;

function parseInvocation(argv) {
	let cwd = repoRoot;
	const remaining = [...argv];
	if (remaining[0] === "--cwd") {
		const cwdArg = remaining[1]?.trim();
		if (!cwdArg) {
			throw new Error("--cwd requires a non-empty repo-relative directory.");
		}
		cwd = resolveRepoCwd(cwdArg);
		remaining.splice(0, 2);
	}

	const [command, ...args] = remaining;
	return {
		args,
		command,
		cwd,
	};
}

function resolveRepoCwd(value) {
	const resolved = resolve(repoRoot, value);
	if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${sep}`)) {
		throw new Error(`--cwd must stay within the repository: ${value}`);
	}
	return resolved;
}

function positiveIntegerEnv(name, defaultValue) {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return defaultValue;
	}

	const parsedValue = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return parsedValue;
}

function delay(ms) {
	return new Promise((resolveDelay) => {
		setTimeout(resolveDelay, ms);
	});
}

function lockDescription() {
	try {
		return readFileSync(stagingSmokeLockPath, "utf-8").trim();
	} catch {
		return "";
	}
}

function lockIsStale() {
	try {
		const stats = statSync(stagingSmokeLockPath);
		return Date.now() - stats.mtimeMs > stagingSmokeLockStaleMs;
	} catch {
		return false;
	}
}

async function acquireStagingSmokeLock() {
	mkdirSync(dirname(stagingSmokeLockPath), { recursive: true });
	const deadline = Date.now() + stagingSmokeLockWaitMs;
	let lastWaitMessageAt = 0;

	while (true) {
		try {
			const fd = openSync(stagingSmokeLockPath, "wx", 0o600);
			writeFileSync(
				fd,
				`${JSON.stringify({
					command: [parsed.command, ...parsed.args],
					cwd: parsed.cwd,
					pid: process.pid,
					startedAt: new Date().toISOString(),
				})}\n`,
				"utf-8",
			);
			stagingSmokeLockFd = fd;
			return;
		} catch (error) {
			if (!(error instanceof Error && "code" in error) || error.code !== "EEXIST") {
				throw error;
			}

			if (lockIsStale()) {
				rmSync(stagingSmokeLockPath, { force: true });
				continue;
			}

			if (Date.now() >= deadline) {
				const holder = lockDescription();
				throw new Error(
					`Timed out waiting for staging smoke lock ${stagingSmokeLockPath}${
						holder ? `; current holder: ${holder}` : ""
					}`,
				);
			}

			if (Date.now() - lastWaitMessageAt > 10_000) {
				console.error(`Waiting for staging smoke lock: ${stagingSmokeLockPath}`);
				lastWaitMessageAt = Date.now();
			}
			await delay(1_000);
		}
	}
}

function releaseStagingSmokeLock() {
	if (stagingSmokeLockFd !== null) {
		closeSync(stagingSmokeLockFd);
		stagingSmokeLockFd = null;
	}
	rmSync(stagingSmokeLockPath, { force: true });
}

function signalExitCode(signal) {
	if (signal === "SIGINT") {
		return 130;
	}
	if (signal === "SIGTERM") {
		return 143;
	}
	return 1;
}

function handleShutdownSignal(signal) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	if (child && !child.killed) {
		child.kill(signal);
		const forcedExit = setTimeout(() => {
			releaseStagingSmokeLock();
			process.exit(signalExitCode(signal));
		}, 5_000);
		forcedExit.unref();
		return;
	}
	releaseStagingSmokeLock();
	process.exit(signalExitCode(signal));
}

try {
	await acquireStagingSmokeLock();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
process.on("exit", releaseStagingSmokeLock);

child = spawn(parsed.command, parsed.args, {
	cwd: parsed.cwd,
	env: process.env,
	shell: process.platform === "win32",
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	releaseStagingSmokeLock();
	if (signal) {
		process.exit(signalExitCode(signal));
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	releaseStagingSmokeLock();
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
