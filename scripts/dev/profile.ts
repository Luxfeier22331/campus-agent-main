import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

export interface LocalDevPorts {
	appApi: number;
	campusWeb: number;
	opsWeb: number;
	opsWebApi: number;
}

export interface LocalDevRuntimePorts {
	agentRuntime: number;
	executionControl: number;
	modelConfig: number;
}

export interface LocalDevProfileV1 {
	bucketName: string;
	createdAt: string;
	databaseName: string;
	instanceId: string;
	ports: LocalDevPorts;
	repoKey: string;
	schemaVersion: 1;
	slot: number;
	worktreePath: string;
}

interface LocalDevRegistryV1 {
	instances: LocalDevProfileV1[];
	schemaVersion: 1;
}

const MAX_SLOT = 99;
const PROFILE_RELATIVE_PATH = "var/dev/profile.v1.json";

export function resolveLocalDevProfilePath(repoRoot: string): string {
	return resolve(repoRoot, PROFILE_RELATIVE_PATH);
}

export function calculateLocalDevPorts(slot: number): LocalDevPorts {
	assertSlot(slot);
	return {
		appApi: 27_031 + slot * 100,
		campusWeb: 27_014 + slot * 100,
		opsWeb: 5_178 + slot * 10,
		opsWebApi: 5_179 + slot * 10,
	};
}

export function calculateLocalDevRuntimePorts(slot: number): LocalDevRuntimePorts {
	assertSlot(slot);
	return {
		agentRuntime: 27_062 + slot * 100,
		executionControl: 27_051 + slot * 100,
		modelConfig: 27_053 + slot * 100,
	};
}

export function ensureLocalDevProfile(repoRoot: string): LocalDevProfileV1 {
	const resolvedRoot = realpathSync(repoRoot);
	const paths = resolveRegistryPaths(resolvedRoot);
	return withRegistryLock(paths.lockPath, () => {
		const profile = readProfile(resolveLocalDevProfilePath(resolvedRoot));
		if (profile) {
			assertProfile(profile, resolvedRoot, paths.repoKey);
			const registry = readRegistry(paths.registryPath);
			const registered = registry.instances.find(
				(instance) => instance.instanceId === profile.instanceId,
			);
			if (registered) {
				if (registered.worktreePath !== profile.worktreePath || registered.slot !== profile.slot) {
					throw new Error(`Conflicting local development registration: ${profile.instanceId}`);
				}
				return profile;
			}
			if (
				registry.instances.some(
					(instance) =>
						instance.slot === profile.slot || instance.worktreePath === profile.worktreePath,
				)
			) {
				throw new Error(`Local development slot ${profile.slot} is already registered.`);
			}
			writeJsonAtomic(paths.registryPath, {
				instances: [...registry.instances, profile].sort((left, right) => left.slot - right.slot),
				schemaVersion: 1,
			} satisfies LocalDevRegistryV1);
			return profile;
		}
		const registry = readRegistry(paths.registryPath);
		const slot = allocateLocalDevSlot(registry.instances, isMainWorktree(resolvedRoot) ? 0 : 1);
		const suffix = randomBytes(4).toString("hex");
		const label = normalizeResourceLabel(basename(resolvedRoot));
		const instanceId = `${label}-${suffix}`;
		const next: LocalDevProfileV1 = {
			bucketName: `campus-agent-derived-wt-${slot}-${suffix}`,
			createdAt: new Date().toISOString(),
			databaseName: `campus_agent_wt_${slot}_${suffix}`,
			instanceId,
			ports: calculateLocalDevPorts(slot),
			repoKey: paths.repoKey,
			schemaVersion: 1,
			slot,
			worktreePath: resolvedRoot,
		};
		writeJsonAtomic(resolveLocalDevProfilePath(resolvedRoot), next);
		writeJsonAtomic(paths.registryPath, {
			instances: [...registry.instances, next].sort((left, right) => left.slot - right.slot),
			schemaVersion: 1,
		} satisfies LocalDevRegistryV1);
		return next;
	});
}

export function loadLocalDevProfile(repoRoot: string): LocalDevProfileV1 {
	const resolvedRoot = realpathSync(repoRoot);
	const profile = readProfile(resolveLocalDevProfilePath(resolvedRoot));
	if (!profile) {
		throw new Error("Local development is not initialized. Run pnpm dev:init first.");
	}
	assertProfile(profile, resolvedRoot, resolveRegistryPaths(resolvedRoot).repoKey);
	return profile;
}

export function listLocalDevProfiles(repoRoot: string): LocalDevProfileV1[] {
	return readRegistry(resolveRegistryPaths(realpathSync(repoRoot)).registryPath).instances;
}

export function releaseLocalDevProfile(repoRoot: string, instanceId: string): LocalDevProfileV1 {
	const resolvedRoot = realpathSync(repoRoot);
	const paths = resolveRegistryPaths(resolvedRoot);
	return withRegistryLock(paths.lockPath, () => {
		const registry = readRegistry(paths.registryPath);
		const target = registry.instances.find((profile) => profile.instanceId === instanceId);
		if (!target) {
			throw new Error(`Unknown local development instance: ${instanceId}`);
		}
		writeJsonAtomic(paths.registryPath, {
			instances: registry.instances.filter((profile) => profile.instanceId !== instanceId),
			schemaVersion: 1,
		} satisfies LocalDevRegistryV1);
		const targetProfilePath = resolveLocalDevProfilePath(target.worktreePath);
		if (readProfile(targetProfilePath)?.instanceId === instanceId) {
			rmSync(targetProfilePath, { force: true });
		}
		return target;
	});
}

export function normalizeResourceLabel(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 28);
	return normalized || "worktree";
}

function resolveRegistryPaths(repoRoot: string): {
	lockPath: string;
	registryPath: string;
	repoKey: string;
} {
	const commonDir = resolve(
		repoRoot,
		execFileSync("git", ["rev-parse", "--git-common-dir"], {
			cwd: repoRoot,
			encoding: "utf8",
		}).trim(),
	);
	const repoKey = createHash("sha256").update(realpathSync(commonDir)).digest("hex").slice(0, 12);
	const stateDir = resolve(
		process.env.XDG_STATE_HOME?.trim() || resolve(homedir(), ".local/state"),
		"campus-agent",
		repoKey,
	);
	return {
		lockPath: resolve(stateDir, "instances.lock"),
		registryPath: resolve(stateDir, "instances.v1.json"),
		repoKey,
	};
}

export function isMainWorktree(repoRoot: string): boolean {
	const gitDir = resolve(
		repoRoot,
		execFileSync("git", ["rev-parse", "--git-dir"], { cwd: repoRoot, encoding: "utf8" }).trim(),
	);
	const commonDir = resolve(
		repoRoot,
		execFileSync("git", ["rev-parse", "--git-common-dir"], {
			cwd: repoRoot,
			encoding: "utf8",
		}).trim(),
	);
	return realpathSync(gitDir) === realpathSync(commonDir);
}

export function allocateLocalDevSlot(
	instances: Pick<LocalDevProfileV1, "slot">[],
	firstSlot: number,
): number {
	const occupied = new Set(instances.map(({ slot }) => slot));
	for (let slot = firstSlot; slot <= MAX_SLOT; slot += 1) {
		if (!occupied.has(slot)) {
			return slot;
		}
	}
	throw new Error(`No local development slots remain between ${firstSlot} and ${MAX_SLOT}.`);
}

function readProfile(path: string): LocalDevProfileV1 | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as LocalDevProfileV1;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function readRegistry(path: string): LocalDevRegistryV1 {
	try {
		const registry = JSON.parse(readFileSync(path, "utf8")) as LocalDevRegistryV1;
		if (registry.schemaVersion !== 1 || !Array.isArray(registry.instances)) {
			throw new Error(`Unsupported local development registry: ${path}`);
		}
		return registry;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { instances: [], schemaVersion: 1 };
		}
		throw error;
	}
}

function assertProfile(profile: LocalDevProfileV1, repoRoot: string, repoKey?: string): void {
	if (
		profile.schemaVersion !== 1 ||
		profile.worktreePath !== repoRoot ||
		(repoKey !== undefined && profile.repoKey !== repoKey) ||
		!profile.instanceId ||
		!profile.databaseName ||
		!profile.bucketName
	) {
		throw new Error(`Invalid local development profile: ${resolveLocalDevProfilePath(repoRoot)}`);
	}
	assertSlot(profile.slot);
	if (JSON.stringify(profile.ports) !== JSON.stringify(calculateLocalDevPorts(profile.slot))) {
		throw new Error(`Local development profile ports do not match slot ${profile.slot}.`);
	}
}

function assertSlot(slot: number): void {
	if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
		throw new Error(`Local development slot must be between 0 and ${MAX_SLOT}.`);
	}
}

function withRegistryLock<T>(lockPath: string, operation: () => T): T {
	mkdirSync(dirname(lockPath), { recursive: true });
	try {
		mkdirSync(lockPath);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			throw new Error("Another local development lifecycle command is running.");
		}
		throw error;
	}
	try {
		return operation();
	} finally {
		rmSync(lockPath, { force: true, recursive: true });
	}
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporaryPath, path);
}
