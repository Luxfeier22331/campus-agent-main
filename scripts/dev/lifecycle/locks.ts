import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";

export async function withLifecycleLock<T>(
	lockPath: string,
	command: string,
	operation: () => Promise<T>,
): Promise<T> {
	acquireLifecycleLock(lockPath, command);
	try {
		return await operation();
	} finally {
		releaseLifecycleLock(lockPath);
	}
}

export function withLifecycleLockSync<T>(lockPath: string, command: string, operation: () => T): T {
	acquireLifecycleLock(lockPath, command);
	try {
		return operation();
	} finally {
		releaseLifecycleLock(lockPath);
	}
}

export function acquireLifecycleLock(lockPath: string, command: string): void {
	mkdirSync(dirname(lockPath), { recursive: true });
	try {
		mkdirSync(lockPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
			throw error;
		}
		const ownerPath = resolve(lockPath, "owner.json");
		const owner = readLockOwner(ownerPath);
		if (owner && !isProcessAlive(owner.pid)) {
			rmSync(lockPath, { force: true, recursive: true });
			mkdirSync(lockPath);
		} else {
			throw new Error(`Another local development lifecycle command is running: ${lockPath}`);
		}
	}
	writeFileSync(
		resolve(lockPath, "owner.json"),
		`${JSON.stringify({
			command,
			host: hostname(),
			pid: process.pid,
			startedAt: new Date().toISOString(),
			token: randomUUID(),
		})}\n`,
		{ mode: 0o600 },
	);
}

export function releaseLifecycleLock(lockPath: string): void {
	rmSync(lockPath, { force: true, recursive: true });
}

function readLockOwner(path: string): { pid: number } | null {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown };
		return typeof value.pid === "number" ? { pid: value.pid } : null;
	} catch {
		return null;
	}
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}
