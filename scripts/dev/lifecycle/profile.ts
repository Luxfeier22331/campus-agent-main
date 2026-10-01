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

export interface LocalDevInfrastructurePorts {
	hindsightApi: number;
	objectStore: number;
	objectStoreConsole: number;
	postgres: number;
	qdrantGrpc: number;
	qdrantHttp: number;
	temporal: number;
	temporalUi: number;
}

export interface LocalDevProfile {
	bucketName: string;
	createdAt: string;
	databaseName: string;
	instanceId: string;
	infraPorts: LocalDevInfrastructurePorts;
	infraProject: string;
	ports: LocalDevPorts;
	repoKey: string;
	resourceKey: string;
	schemaVersion: 3;
	slot: number;
	sourceBucketName: string;
	worktreePath: string;
}

interface LocalDevRegistryV3 {
	instances: LocalDevProfile[];
	schemaVersion: 3;
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

export function calculateLocalDevInfrastructurePorts(slot: number): LocalDevInfrastructurePorts {
	assertSlot(slot);
	return {
		hindsightApi: 27_088 + slot * 100,
		objectStore: 25_900 + slot * 100,
		objectStoreConsole: 25_901 + slot * 100,
		postgres: 25_432 + slot * 100,
		qdrantGrpc: 26_344 + slot * 100,
		qdrantHttp: 26_343 + slot * 100,
		temporal: 27_233 + slot * 100,
		temporalUi: 27_233 + slot * 100 + 1,
	};
}

export async function ensureLocalDevProfile(repoRoot: string): Promise<LocalDevProfile> {
	const resolvedRoot = realpathSync(repoRoot);
	const paths = resolveRegistryPaths(resolvedRoot);
	return await withLifecycleLock(paths.lockPath, "profile", async () => {
		const registry = readRegistry(paths.registryPath, paths.legacyRegistryPath);
		assertRegistry(registry.instances, paths.repoKey);
		const profilePath = resolveLocalDevProfilePath(resolvedRoot);
		const legacyProfilePath = resolveLegacyLocalDevProfilePath(resolvedRoot);
		if (existsSync(legacyProfilePath)) {
			throw new Error(
				`Legacy local development profile found at ${legacyProfilePath}; remove it manually and run pnpm dev:init again.`,
			);
		}
		const existingRaw = readJsonIfExists(profilePath);
		if (existingRaw !== null) {
			const profile = parseProfile(existingRaw);
			assertProfile(profile, resolvedRoot, paths.repoKey);
			const registered = registry.instances.find(
				(instance) => instance.instanceId === profile.instanceId,
			);
			if (registered) {
				assertProfileRegistration(registered, profile);
				const upgradedInstances = registry.instances.map((item) =>
					item.instanceId === profile.instanceId ? profile : item,
				);
				writeRegistry(
					paths.registryPath,
					{ instances: upgradedInstances, schemaVersion: 3 },
					paths.legacyRegistryPath,
				);
				return profile;
			}
			assertNoRegistrationConflict(registry.instances, profile);
			writeRegistry(
				paths.registryPath,
				{
					instances: [...registry.instances, profile].sort((left, right) => left.slot - right.slot),
					schemaVersion: 3,
				},
				paths.legacyRegistryPath,
			);
			return profile;
		}

		const firstSlot = isMainWorktree(resolvedRoot) ? 0 : 1;
		const slot = await allocateAvailableSlot(registry.instances, firstSlot);
		const resourceKey = randomBytes(4).toString("hex");
		const label = normalizeResourceLabel(basename(resolvedRoot));
		const infraPorts = calculateLocalDevInfrastructurePorts(slot);
		const profile: LocalDevProfile = {
			bucketName: `campus-agent-derived-wt-${slot}-${resourceKey}`,
			createdAt: new Date().toISOString(),
			databaseName: `campus_agent_wt_${slot}_${resourceKey}`,
			instanceId: `${label}-${resourceKey}`,
			infraPorts,
			infraProject: `campus-agent-wt-${resourceKey}`,
			ports: calculateLocalDevPorts(slot),
			repoKey: paths.repoKey,
			resourceKey,
			schemaVersion: 3,
			slot,
			sourceBucketName: `campus-agent-source-wt-${slot}-${resourceKey}`,
			worktreePath: resolvedRoot,
		};
		assertNoRegistrationConflict(registry.instances, profile);
		writeJsonAtomic(profilePath, profile);
		writeRegistry(
			paths.registryPath,
			{
				instances: [...registry.instances, profile].sort((left, right) => left.slot - right.slot),
				schemaVersion: 3,
			},
			paths.legacyRegistryPath,
		);
		return profile;
	});
}

export function loadLocalDevProfile(repoRoot: string): LocalDevProfile {
	const resolvedRoot = realpathSync(repoRoot);
	const paths = resolveRegistryPaths(resolvedRoot);
	if (existsSync(paths.legacyRegistryPath)) {
		throw new Error(
			`Legacy local development registry found at ${paths.legacyRegistryPath}; remove it manually and run pnpm dev:init again.`,
		);
	}
	const raw = readJsonIfExists(resolveLocalDevProfilePath(resolvedRoot));
	if (existsSync(resolveLegacyLocalDevProfilePath(resolvedRoot))) {
		throw new Error(
			`Legacy local development profile found at ${resolveLegacyLocalDevProfilePath(resolvedRoot)}; remove it manually and run pnpm dev:init again.`,
		);
	}
	if (raw === null) {
		throw new Error("Local development is not initialized. Run pnpm dev:init first.");
	}
	const profile = parseProfile(raw);
	assertProfile(profile, resolvedRoot, paths.repoKey);
	return profile;
}

export function listLocalDevProfiles(repoRoot: string): LocalDevProfile[] {
	const paths = resolveRegistryPaths(realpathSync(repoRoot));
	const registry = readRegistry(paths.registryPath, paths.legacyRegistryPath);
	assertRegistry(registry.instances, paths.repoKey);
	return registry.instances;
}

export function resolveLocalDevRegistryPath(repoRoot: string): string {
	return resolveRegistryPaths(realpathSync(repoRoot)).registryPath;
}

export function releaseLocalDevProfile(repoRoot: string, instanceId: string): LocalDevProfile {
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
				schemaVersion: 3,
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
	instances: Pick<LocalDevProfile, "slot">[],
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
	profile: Pick<LocalDevProfile, "resourceKey" | "slot">,
): {
	bucketName: string;
	databaseName: string;
	sourceBucketName: string;
} {
	return {
		bucketName: `campus-agent-derived-wt-${profile.slot}-${profile.resourceKey}`,
		databaseName: `campus_agent_wt_${profile.slot}_${profile.resourceKey}`,
		sourceBucketName: `campus-agent-source-wt-${profile.slot}-${profile.resourceKey}`,
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
	instances: Pick<LocalDevProfile, "slot">[],
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
			...Object.values(calculateLocalDevInfrastructurePorts(slot)),
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

function readRegistry(registryPath: string, legacyRegistryPath: string): LocalDevRegistryV3 {
	if (existsSync(legacyRegistryPath)) {
		throw new Error(
			`Legacy local development registry found at ${legacyRegistryPath}; remove it manually and run pnpm dev:init again.`,
		);
	}
	const current = readJsonIfExists(registryPath);
	if (current !== null) {
		return parseRegistry(current);
	}
	return { instances: [], schemaVersion: 3 };
}

function parseRegistry(value: unknown): LocalDevRegistryV3 {
	if (!(isRecord(value) && value.schemaVersion === 3 && Array.isArray(value.instances))) {
		throw new Error("Unsupported local development registry.");
	}
	return { instances: value.instances.map(parseProfile), schemaVersion: 3 };
}

function parseProfile(value: unknown): LocalDevProfile {
	if (!(isRecord(value) && value.schemaVersion === 3)) {
		throw new Error(
			"Unsupported local development profile version; remove the old profile manually and run pnpm dev:init.",
		);
	}
	const slot = numberField(value, "slot");
	return {
		bucketName: stringField(value, "bucketName"),
		createdAt: stringField(value, "createdAt"),
		databaseName: stringField(value, "databaseName"),
		instanceId: stringField(value, "instanceId"),
		infraPorts: infrastructurePortsField(value.infraPorts, slot),
		infraProject: stringField(value, "infraProject"),
		ports: portsField(value.ports),
		repoKey: stringField(value, "repoKey"),
		resourceKey: stringField(value, "resourceKey"),
		schemaVersion: 3,
		slot,
		sourceBucketName: stringField(value, "sourceBucketName"),
		worktreePath: stringField(value, "worktreePath"),
	};
}

function assertProfile(
	profile: LocalDevProfile,
	repoRoot: string,
	repoKey?: string,
	allowMissingWorktree = false,
): void {
	assertProfileIdentity(profile, repoKey);
	if (!allowMissingWorktree && profile.worktreePath !== repoRoot) {
		throw new Error("Invalid local development profile identity.");
	}
	assertProfilePortDerivation(profile);
}

function assertProfileIdentity(profile: LocalDevProfile, repoKey?: string): void {
	if (
		profile.schemaVersion !== 3 ||
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
		profile.bucketName !== expected.bucketName ||
		profile.sourceBucketName !== expected.sourceBucketName ||
		profile.infraProject !== `campus-agent-wt-${profile.resourceKey}`
	) {
		throw new Error(
			`Local development profile resource identity does not match ${profile.instanceId}.`,
		);
	}
}

function assertProfilePortDerivation(profile: LocalDevProfile): void {
	if (JSON.stringify(profile.ports) !== JSON.stringify(calculateLocalDevPorts(profile.slot))) {
		throw new Error(`Local development profile ports do not match slot ${profile.slot}.`);
	}
	if (
		JSON.stringify(profile.infraPorts) !==
		JSON.stringify(calculateLocalDevInfrastructurePorts(profile.slot))
	) {
		throw new Error(
			`Local infrastructure ports do not match slot ${profile.slot}; destroy the instance with pnpm dev:destroy and run pnpm dev:init again.`,
		);
	}
}

function assertRegistry(instances: LocalDevProfile[], repoKey: string): void {
	for (const profile of instances) {
		assertProfileIdentity(profile, repoKey);
	}
}

function assertProfileRegistration(left: LocalDevProfile, right: LocalDevProfile): void {
	if (
		left.worktreePath !== right.worktreePath ||
		left.slot !== right.slot ||
		left.databaseName !== right.databaseName ||
		left.bucketName !== right.bucketName ||
		left.sourceBucketName !== right.sourceBucketName
	) {
		throw new Error(`Conflicting local development registration: ${right.instanceId}`);
	}
}

function assertNoRegistrationConflict(
	instances: LocalDevProfile[],
	profile: LocalDevProfile,
): void {
	if (
		instances.some(
			(instance) =>
				instance.instanceId === profile.instanceId ||
				instance.slot === profile.slot ||
				instance.worktreePath === profile.worktreePath ||
				instance.databaseName === profile.databaseName ||
				instance.bucketName === profile.bucketName ||
				instance.sourceBucketName === profile.sourceBucketName,
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

function writeRegistry(path: string, registry: LocalDevRegistryV3, legacyPath?: string): void {
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
	if (isRecord(raw) && raw.schemaVersion === 3 && raw.instanceId === instanceId) {
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

function infrastructurePortsField(value: unknown, slot: number): LocalDevInfrastructurePorts {
	if (!isRecord(value)) {
		throw new Error("Invalid local development infrastructure ports.");
	}
	return {
		hindsightApi:
			value.hindsightApi === undefined
				? calculateLocalDevInfrastructurePorts(slot).hindsightApi
				: numberField(value, "hindsightApi"),
		objectStore: numberField(value, "objectStore"),
		objectStoreConsole: numberField(value, "objectStoreConsole"),
		postgres: numberField(value, "postgres"),
		qdrantGrpc: numberField(value, "qdrantGrpc"),
		qdrantHttp: numberField(value, "qdrantHttp"),
		temporal: numberField(value, "temporal"),
		temporalUi: numberField(value, "temporalUi"),
	};
}
