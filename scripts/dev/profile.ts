import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { withLifecycleLock, withLifecycleLockSync } from "./locks";
import { probeLocalPorts } from "./ports";

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

export interface LocalDevProfileV2 {
	bucketName: string;
	createdAt: string;
	databaseName: string;
	instanceId: string;
	ports: LocalDevPorts;
	repoKey: string;
	resourceKey: string;
	schemaVersion: 2;
	slot: number;
	worktreePath: string;
}

export type LocalDevProfile = LocalDevProfileV2;

interface LocalDevRegistryV2 {
	instances: LocalDevProfileV2[];
	schemaVersion: 2;
}

const MAX_SLOT = 99;
const PROFILE_RELATIVE_PATH = "var/dev/profile.json";
const LEGACY_PROFILE_RELATIVE_PATH = "var/dev/profile.v1.json";
const REGISTRY_FILENAME = "instances.json";
const LEGACY_REGISTRY_FILENAME = "instances.v1.json";
const LOCK_FILENAME = "instances.lock";

export function resolveLocalDevProfilePath(repoRoot: string): string {
	return resolve(repoRoot, PROFILE_RELATIVE_PATH);
}

export function resolveLegacyLocalDevProfilePath(repoRoot: string): string {
	return resolve(repoRoot, LEGACY_PROFILE_RELATIVE_PATH);
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

export async function ensureLocalDevProfile(repoRoot: string): Promise<LocalDevProfileV2> {
	const resolvedRoot = realpathSync(repoRoot);
	const paths = resolveRegistryPaths(resolvedRoot);
	return await withLifecycleLock(paths.lockPath, "profile", async () => {
		const registry = readRegistry(paths.registryPath, paths.legacyRegistryPath);
		assertRegistry(registry.instances, paths.repoKey);
		const profilePath = resolveLocalDevProfilePath(resolvedRoot);
		const legacyProfilePath = resolveLegacyLocalDevProfilePath(resolvedRoot);
		const existingRaw = readJsonIfExists(profilePath) ?? readJsonIfExists(legacyProfilePath);
		if (existingRaw !== null) {
			const profile = upgradeProfile(existingRaw);
			if (!profile) {
				throw new Error("Invalid local development profile.");
			}
			assertProfile(profile, resolvedRoot, paths.repoKey);
			if (existsSync(legacyProfilePath) && !existsSync(profilePath)) {
				writeJsonAtomic(profilePath, profile);
				rmSync(legacyProfilePath, { force: true });
			}
			const registered = registry.instances.find(
				(instance) => instance.instanceId === profile.instanceId,
			);
			if (registered) {
				assertProfileRegistration(registered, profile);
				if (!existsSync(paths.registryPath) || existsSync(paths.legacyRegistryPath)) {
					writeRegistry(paths.registryPath, registry, paths.legacyRegistryPath);
				}
				return profile;
			}
			assertNoRegistrationConflict(registry.instances, profile);
			writeRegistry(
				paths.registryPath,
				{
					instances: [...registry.instances, profile].sort((left, right) => left.slot - right.slot),
					schemaVersion: 2,
				},
				paths.legacyRegistryPath,
			);
			return profile;
		}

		const firstSlot = isMainWorktree(resolvedRoot) ? 0 : 1;
		const slot = await allocateAvailableSlot(registry.instances, firstSlot);
		const resourceKey = randomBytes(4).toString("hex");
		const label = normalizeResourceLabel(basename(resolvedRoot));
		const profile: LocalDevProfileV2 = {
			bucketName: `campus-agent-derived-wt-${slot}-${resourceKey}`,
			createdAt: new Date().toISOString(),
			databaseName: `campus_agent_wt_${slot}_${resourceKey}`,
			instanceId: `${label}-${resourceKey}`,
			ports: calculateLocalDevPorts(slot),
			repoKey: paths.repoKey,
			resourceKey,
			schemaVersion: 2,
			slot,
			worktreePath: resolvedRoot,
		};
		assertNoRegistrationConflict(registry.instances, profile);
		writeJsonAtomic(profilePath, profile);
		writeRegistry(
			paths.registryPath,
			{
				instances: [...registry.instances, profile].sort((left, right) => left.slot - right.slot),
				schemaVersion: 2,
			},
			paths.legacyRegistryPath,
		);
		return profile;
	});
}

export function loadLocalDevProfile(repoRoot: string): LocalDevProfileV2 {
	const resolvedRoot = realpathSync(repoRoot);
	const raw =
		readJsonIfExists(resolveLocalDevProfilePath(resolvedRoot)) ??
		readJsonIfExists(resolveLegacyLocalDevProfilePath(resolvedRoot));
	const profile = upgradeProfile(raw);
	if (!profile) {
		throw new Error("Local development is not initialized. Run pnpm dev:init first.");
	}
	assertProfile(profile, resolvedRoot, resolveRegistryPaths(resolvedRoot).repoKey);
	return profile;
}

/** Read-only: legacy state is upgraded in memory but never written. */
export function listLocalDevProfiles(repoRoot: string): LocalDevProfileV2[] {
	const paths = resolveRegistryPaths(realpathSync(repoRoot));
	const registry = readRegistry(paths.registryPath, paths.legacyRegistryPath);
	assertRegistry(registry.instances, paths.repoKey);
	return registry.instances;
}

export function resolveLocalDevRegistryPath(repoRoot: string): string {
	return resolveRegistryPaths(realpathSync(repoRoot)).registryPath;
}

export function releaseLocalDevProfile(repoRoot: string, instanceId: string): LocalDevProfileV2 {
	const resolvedRoot = realpathSync(repoRoot);
	const paths = resolveRegistryPaths(resolvedRoot);
	return withLifecycleLockSync(paths.lockPath, "profile", () => {
		const registry = readRegistry(paths.registryPath, paths.legacyRegistryPath);
		assertRegistry(registry.instances, paths.repoKey);
		const target = registry.instances.find((profile) => profile.instanceId === instanceId);
		if (!target) {
			throw new Error(`Unknown local development instance: ${instanceId}`);
		}
		writeRegistry(
			paths.registryPath,
			{
				instances: registry.instances.filter((profile) => profile.instanceId !== instanceId),
				schemaVersion: 2,
			},
			paths.legacyRegistryPath,
		);
		removeProfileIfMatches(resolveLocalDevProfilePath(target.worktreePath), instanceId);
		removeProfileIfMatches(resolveLegacyLocalDevProfilePath(target.worktreePath), instanceId);
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
	instances: Pick<LocalDevProfileV2, "slot">[],
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

export function expectedLocalDevResourceNames(
	profile: Pick<LocalDevProfileV2, "resourceKey" | "slot">,
): {
	bucketName: string;
	databaseName: string;
} {
	return {
		bucketName: `campus-agent-derived-wt-${profile.slot}-${profile.resourceKey}`,
		databaseName: `campus_agent_wt_${profile.slot}_${profile.resourceKey}`,
	};
}

function resolveRegistryPaths(repoRoot: string): {
	legacyRegistryPath: string;
	lockPath: string;
	repoKey: string;
	registryPath: string;
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
		legacyRegistryPath: resolve(stateDir, LEGACY_REGISTRY_FILENAME),
		lockPath: resolve(stateDir, LOCK_FILENAME),
		repoKey,
		registryPath: resolve(stateDir, REGISTRY_FILENAME),
	};
}

export async function allocateAvailableSlot(
	instances: Pick<LocalDevProfileV2, "slot">[],
	firstSlot: number,
	probe: typeof probeLocalPorts = probeLocalPorts,
): Promise<number> {
	for (let slot = firstSlot; slot <= MAX_SLOT; slot += 1) {
		if (instances.some((instance) => instance.slot === slot)) {
			continue;
		}
		const ports = [
			...Object.values(calculateLocalDevPorts(slot)),
			...Object.values(calculateLocalDevRuntimePorts(slot)),
		];
		const result = await probe(ports);
		if (result.unknown.length > 0) {
			throw new Error(`Unable to inspect local development ports: ${result.unknown.join(", ")}.`);
		}
		if (result.occupied.length > 0) {
			continue;
		}
		return slot;
	}
	throw new Error(`No local development slots remain between ${firstSlot} and ${MAX_SLOT}.`);
}

function readRegistry(registryPath: string, legacyRegistryPath: string): LocalDevRegistryV2 {
	const current = readJsonIfExists(registryPath);
	if (current !== null) {
		return upgradeRegistry(current);
	}
	const legacy = readJsonIfExists(legacyRegistryPath);
	return legacy === null ? { instances: [], schemaVersion: 2 } : upgradeRegistry(legacy);
}

function upgradeRegistry(value: unknown): LocalDevRegistryV2 {
	if (!(isRecord(value) && Array.isArray(value.instances))) {
		throw new Error("Unsupported local development registry.");
	}
	const instances = value.instances.map((instance) => upgradeProfile(instance));
	if (instances.some((instance) => instance === null)) {
		throw new Error("Invalid local development registry entry.");
	}
	return { instances: instances as LocalDevProfileV2[], schemaVersion: 2 };
}

function upgradeProfile(value: unknown): LocalDevProfileV2 | null {
	if (value === null) {
		return null;
	}
	if (!isRecord(value)) {
		throw new Error("Invalid local development profile.");
	}
	if (value.schemaVersion === 2) {
		return {
			bucketName: stringField(value, "bucketName"),
			createdAt: stringField(value, "createdAt"),
			databaseName: stringField(value, "databaseName"),
			instanceId: stringField(value, "instanceId"),
			ports: portsField(value.ports),
			repoKey: stringField(value, "repoKey"),
			resourceKey: stringField(value, "resourceKey"),
			schemaVersion: 2,
			slot: numberField(value, "slot"),
			worktreePath: stringField(value, "worktreePath"),
		};
	}
	if (value.schemaVersion !== 1) {
		throw new Error("Unsupported local development profile version.");
	}
	const resourceKey = deriveResourceKey(value);
	return {
		bucketName: stringField(value, "bucketName"),
		createdAt: stringField(value, "createdAt"),
		databaseName: stringField(value, "databaseName"),
		instanceId: stringField(value, "instanceId"),
		ports: portsField(value.ports),
		repoKey: stringField(value, "repoKey"),
		resourceKey,
		schemaVersion: 2,
		slot: numberField(value, "slot"),
		worktreePath: stringField(value, "worktreePath"),
	};
}

function deriveResourceKey(value: Record<string, unknown>): string {
	const candidates = [
		stringField(value, "databaseName").match(/^campus_agent_wt_[0-9]+_([a-f0-9]{8})$/u)?.[1],
		stringField(value, "bucketName").match(/^[a-z0-9][a-z0-9.-]*-[0-9]+-([a-f0-9]{8})$/u)?.[1],
		stringField(value, "instanceId").match(/-([a-f0-9]{8})$/u)?.[1],
	].filter((candidate): candidate is string => candidate !== undefined);
	if (candidates.length === 0 || candidates.some((candidate) => candidate !== candidates[0])) {
		throw new Error("Legacy local development profile has inconsistent resource identities.");
	}
	return candidates[0];
}

function assertProfile(
	profile: LocalDevProfileV2,
	repoRoot: string,
	repoKey?: string,
	allowMissingWorktree = false,
): void {
	assertProfileIdentity(profile, repoKey);
	if (!allowMissingWorktree && profile.worktreePath !== repoRoot) {
		throw new Error("Invalid local development profile identity.");
	}
}

function assertProfileIdentity(profile: LocalDevProfileV2, repoKey?: string): void {
	if (
		profile.schemaVersion !== 2 ||
		!isAbsolute(profile.worktreePath) ||
		(repoKey !== undefined && profile.repoKey !== repoKey) ||
		!/^[a-f0-9]{8}$/u.test(profile.resourceKey) ||
		!profile.instanceId.endsWith(`-${profile.resourceKey}`)
	) {
		throw new Error("Invalid local development profile identity.");
	}
	assertSlot(profile.slot);
	const expected = expectedLocalDevResourceNames(profile);
	if (
		profile.databaseName !== expected.databaseName ||
		!profile.bucketName.endsWith(`-${profile.slot}-${profile.resourceKey}`)
	) {
		throw new Error(
			`Local development profile resource identity does not match ${profile.instanceId}.`,
		);
	}
	if (JSON.stringify(profile.ports) !== JSON.stringify(calculateLocalDevPorts(profile.slot))) {
		throw new Error(`Local development profile ports do not match slot ${profile.slot}.`);
	}
}

function assertRegistry(instances: LocalDevProfileV2[], repoKey: string): void {
	for (const profile of instances) {
		assertProfile(profile, profile.worktreePath, repoKey, true);
	}
}

function assertProfileRegistration(left: LocalDevProfileV2, right: LocalDevProfileV2): void {
	if (
		left.worktreePath !== right.worktreePath ||
		left.slot !== right.slot ||
		left.databaseName !== right.databaseName ||
		left.bucketName !== right.bucketName
	) {
		throw new Error(`Conflicting local development registration: ${right.instanceId}`);
	}
}

function assertNoRegistrationConflict(
	instances: LocalDevProfileV2[],
	profile: LocalDevProfileV2,
): void {
	if (
		instances.some(
			(instance) =>
				instance.instanceId === profile.instanceId ||
				instance.slot === profile.slot ||
				instance.worktreePath === profile.worktreePath ||
				instance.databaseName === profile.databaseName ||
				instance.bucketName === profile.bucketName,
		)
	) {
		throw new Error(`Conflicting local development registration: ${profile.instanceId}`);
	}
}

function assertSlot(slot: number): void {
	if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
		throw new Error(`Local development slot must be between 0 and ${MAX_SLOT}.`);
	}
}

function writeRegistry(path: string, registry: LocalDevRegistryV2, legacyPath?: string): void {
	writeJsonAtomic(path, registry);
	if (legacyPath && legacyPath !== path) {
		retireLegacyRegistry(legacyPath);
	}
}

function retireLegacyRegistry(path: string): void {
	rmSync(path, { force: true });
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporaryPath, path);
}

function readJsonIfExists(path: string): unknown | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function removeProfileIfMatches(path: string, instanceId: string): void {
	const raw = readJsonIfExists(path);
	if (raw === null) {
		return;
	}
	const profile = upgradeProfile(raw);
	if (profile?.instanceId === instanceId) {
		rmSync(path, { force: true });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
	const result = value[field];
	if (typeof result !== "string" || !result) {
		throw new Error(`Invalid local development field: ${field}`);
	}
	return result;
}

function numberField(value: Record<string, unknown>, field: string): number {
	const result = value[field];
	if (typeof result !== "number" || !Number.isSafeInteger(result)) {
		throw new Error(`Invalid local development field: ${field}`);
	}
	return result;
}

function portsField(value: unknown): LocalDevPorts {
	if (!isRecord(value)) {
		throw new Error("Invalid local development ports.");
	}
	return {
		appApi: numberField(value, "appApi"),
		campusWeb: numberField(value, "campusWeb"),
		opsWeb: numberField(value, "opsWeb"),
		opsWebApi: numberField(value, "opsWebApi"),
	};
}
