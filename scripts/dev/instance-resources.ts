import { existsSync } from "node:fs";

import {
	createLocalDatabase,
	grantDatabaseConnect,
	localDatabaseProbe,
	quoteIdentifier,
	runPsql,
} from "./database-roles";
import { captureCommandResult, runCommand } from "./process";
import {
	calculateLocalDevRuntimePorts,
	type LocalDevProfileV2,
	listLocalDevProfiles,
	loadLocalDevProfile,
	resolveLegacyLocalDevProfilePath,
	resolveLocalDevProfilePath,
} from "./profile";
import {
	DOCS_BUCKET,
	inspectSharedCapabilities,
	localBucketProbe,
	runObjectStore,
	SOURCE_BUCKET,
} from "./shared-infrastructure";
import type { LocalDevCapability } from "./targets";

const TEMPORAL_PROJECT = "campus-agent-local";
const TEMPORAL_NAMESPACE_TIMEOUT_MS = 10_000;

export type LocalDevInstanceStatus =
	| "ready"
	| "stale"
	| "partial"
	| "unprovisioned"
	| "unknown"
	| "registered";

export interface LocalDevInstanceDiagnosis {
	bucket: "present" | "missing" | "unknown";
	database: "present" | "missing" | "unknown";
	namespace: "present" | "missing" | "unknown";
	profile: LocalDevProfileV2;
	status: LocalDevInstanceStatus;
	worktree: "present" | "missing";
}

export interface LocalInstanceResourceCleanup {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: LocalResourceProbe;
	unresolved: Array<"bucket" | "database" | "namespace">;
}

export interface LocalInstanceResourceCleanupPlan {
	deleteBucket: boolean;
	deleteDatabase: boolean;
	deleteNamespace: boolean;
	unresolved: Array<"bucket" | "database" | "namespace">;
}

export type IsolatedResourceState = "absent" | "complete" | "partial" | "unknown";
export type IsolatedResourceAction =
	| "create"
	| "ready"
	| "repair-bucket"
	| "repair-database"
	| "unknown";

export function classifyIsolatedResourceState(input: {
	bucketExists: boolean;
	databaseExists: boolean;
}): Exclude<IsolatedResourceState, "unknown"> {
	if (input.bucketExists && input.databaseExists) {
		return "complete";
	}
	if (!(input.bucketExists || input.databaseExists)) {
		return "absent";
	}
	return "partial";
}

export function resolveIsolatedResourceAction(input: {
	bucketExists: boolean;
	databaseExists: boolean;
}): Exclude<IsolatedResourceAction, "unknown"> {
	if (input.bucketExists && !input.databaseExists) {
		return "repair-database";
	}
	if (!input.bucketExists && input.databaseExists) {
		return "repair-bucket";
	}
	return input.bucketExists ? "ready" : "create";
}

export function assertDestroyConfirmation(instanceId: string, confirmation?: string): void {
	if (confirmation !== instanceId) {
		throw new Error(`Destruction requires --confirm ${instanceId}.`);
	}
}

export function resolveLocalInstanceResourceCleanup(input: {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: LocalResourceProbe;
}): LocalInstanceResourceCleanupPlan {
	return {
		deleteBucket: input.bucket === "present",
		deleteDatabase: input.database === "present",
		deleteNamespace: input.namespace === "present",
		unresolved: [
			...(input.database === "unknown" ? (["database"] as const) : []),
			...(input.bucket === "unknown" ? (["bucket"] as const) : []),
			...(input.namespace === "unknown" ? (["namespace"] as const) : []),
		],
	};
}

export async function ensureLocalInstanceResources(
	profile: LocalDevProfileV2,
	options: { ensureBucket?: boolean; repair?: boolean } = {},
): Promise<void> {
	const databaseProbe = localDatabaseProbe(profile.databaseName);
	const ensureBucket = options.ensureBucket ?? true;
	if (databaseProbe === "unknown") {
		throw new Error(
			`Unable to inspect local instance ${profile.instanceId} (database=${databaseProbe}). Check shared infrastructure and retry.`,
		);
	}
	if (!ensureBucket) {
		if (databaseProbe === "missing") {
			createLocalDatabase(profile.databaseName);
			grantDatabaseConnect(profile.databaseName);
		} else if (options.repair) {
			grantDatabaseConnect(profile.databaseName);
		}
		return;
	}
	const bucketProbe = await localBucketProbe(profile.bucketName);
	if (bucketProbe === "unknown") {
		throw new Error(
			`Unable to inspect local instance ${profile.instanceId} (database=${databaseProbe}, bucket=${bucketProbe}). Check shared infrastructure and retry.`,
		);
	}
	const action = resolveIsolatedResourceAction({
		bucketExists: bucketProbe === "present",
		databaseExists: databaseProbe === "present",
	});
	if (action === "create") {
		createLocalDatabase(profile.databaseName);
		grantDatabaseConnect(profile.databaseName);
		runObjectStore(profile.bucketName, "create");
		runObjectStore(profile.bucketName, "configure");
		return;
	}
	if (action === "repair-database") {
		createLocalDatabase(profile.databaseName);
		grantDatabaseConnect(profile.databaseName);
		runObjectStore(profile.bucketName, "configure");
		return;
	}
	if (action === "repair-bucket") {
		runObjectStore(profile.bucketName, "create");
		runObjectStore(profile.bucketName, "configure");
		grantDatabaseConnect(profile.databaseName);
		return;
	}
	if (options.repair) {
		grantDatabaseConnect(profile.databaseName);
		runObjectStore(profile.bucketName, "configure");
	}
}

export function localTemporalNamespace(profile: LocalDevProfileV2): string {
	return `campus-agent-local-${profile.instanceId}`;
}

export async function probeLocalTemporalNamespace(
	repoRoot: string,
	profile: LocalDevProfileV2,
): Promise<"present" | "missing" | "unknown"> {
	const result = captureCommandResult(
		"docker",
		[
			"compose",
			"--project-name",
			TEMPORAL_PROJECT,
			"-f",
			"infra/local/docker-compose.dev.yml",
			"exec",
			"-T",
			"temporal",
			"temporal",
			"operator",
			"namespace",
			"describe",
			"--address",
			"temporal:7233",
			"--namespace",
			localTemporalNamespace(profile),
		],
		{ cwd: repoRoot, timeout: TEMPORAL_NAMESPACE_TIMEOUT_MS },
	);
	if (result.status === 0 && !result.error && !result.timedOut) {
		return "present";
	}
	if (/Namespace .* not found|namespace .* not found|not found/u.test(result.stderr)) {
		return "missing";
	}
	return "unknown";
}

export async function ensureLocalTemporalNamespace(
	repoRoot: string,
	profile: LocalDevProfileV2,
): Promise<void> {
	const state = await probeLocalTemporalNamespace(repoRoot, profile);
	if (state === "present") {
		return;
	}
	if (state === "unknown") {
		throw new Error(`Unable to inspect Temporal namespace ${localTemporalNamespace(profile)}.`);
	}
	const composeArgs = [
		"compose",
		"--project-name",
		TEMPORAL_PROJECT,
		"-f",
		"infra/local/docker-compose.dev.yml",
		"exec",
		"-T",
		"temporal",
		"temporal",
		"operator",
		"namespace",
	];
	runCommand(
		"docker",
		[
			...composeArgs,
			"create",
			"--address",
			"temporal:7233",
			"--namespace",
			localTemporalNamespace(profile),
			"--retention",
			"24h",
		],
		{ cwd: repoRoot, timeout: TEMPORAL_NAMESPACE_TIMEOUT_MS },
	);
}

export async function destroyLocalInstanceResources(
	repoRoot: string,
	profile: LocalDevProfileV2,
): Promise<LocalInstanceResourceCleanup> {
	let [databaseProbe, bucketProbe, namespaceProbe] = await Promise.all([
		Promise.resolve(localDatabaseProbe(profile.databaseName)),
		localBucketProbe(profile.bucketName),
		probeLocalTemporalNamespace(repoRoot, profile),
	]);
	const cleanupPlan = resolveLocalInstanceResourceCleanup({
		bucket: bucketProbe,
		database: databaseProbe,
		namespace: namespaceProbe,
	});
	if (cleanupPlan.deleteNamespace) {
		await deleteLocalTemporalNamespace(repoRoot, profile);
		namespaceProbe = "missing";
	}
	if (cleanupPlan.deleteDatabase) {
		runPsql(`DROP DATABASE ${quoteIdentifier(profile.databaseName)} WITH (FORCE);`);
		databaseProbe = "missing";
	}
	if (cleanupPlan.deleteBucket) {
		runObjectStore(profile.bucketName, "remove");
		bucketProbe = "missing";
	}
	return {
		bucket: bucketProbe,
		database: databaseProbe,
		namespace: namespaceProbe,
		unresolved: cleanupPlan.unresolved,
	};
}

export function formatProfileSummary(profile: LocalDevProfileV2): string {
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	return [
		`Local instance: ${profile.instanceId}`,
		`Campus Web: http://127.0.0.1:${profile.ports.campusWeb}`,
		`app-api: http://127.0.0.1:${profile.ports.appApi}`,
		`Ops Web: http://127.0.0.1:${profile.ports.opsWeb}/dining`,
		`Execution Control: http://127.0.0.1:${runtimePorts.executionControl}`,
		`Model Config: http://127.0.0.1:${runtimePorts.modelConfig}`,
		`Agent Runtime: http://127.0.0.1:${runtimePorts.agentRuntime}`,
		`Temporal namespace: ${localTemporalNamespace(profile)}`,
		`Database: ${profile.databaseName}`,
		`Source bucket: ${SOURCE_BUCKET}`,
		`Campus docs bucket: ${DOCS_BUCKET}`,
		`Derived bucket: ${profile.bucketName}`,
	].join("\n");
}

export async function diagnoseLocalDevInstances(
	repoRoot: string,
	options: { verify?: boolean } = {},
): Promise<LocalDevInstanceDiagnosis[]> {
	const profiles = listLocalDevProfiles(repoRoot);
	if (!options.verify) {
		return profiles.map((profile) => ({
			bucket: "unknown",
			database: "unknown",
			namespace: "unknown",
			profile,
			status: existsSync(profile.worktreePath) ? "registered" : "stale",
			worktree: existsSync(profile.worktreePath) ? "present" : "missing",
		}));
	}
	const shared = await inspectSharedCapabilities({
		required: ["postgres"] satisfies LocalDevCapability[],
	});
	if (shared.postgres !== "present") {
		return profiles.map((profile) => ({
			bucket: "unknown",
			database: "unknown",
			namespace: "unknown",
			profile,
			status: "unknown",
			worktree: existsSync(profile.worktreePath) ? "present" : "missing",
		}));
	}
	const diagnoses = await mapWithConcurrency(profiles, 4, async (profile) => {
		const [database, bucket, namespace] = await Promise.all([
			Promise.resolve(localDatabaseProbe(profile.databaseName)),
			localBucketProbe(profile.bucketName),
			probeLocalTemporalNamespace(repoRoot, profile),
		]);
		const worktree = existsSync(profile.worktreePath) ? "present" : "missing";
		return {
			bucket,
			database,
			namespace,
			profile,
			status: classifyLocalDevInstanceStatus({ bucket, database, namespace, worktree }),
			worktree,
		} satisfies LocalDevInstanceDiagnosis;
	});
	return diagnoses;
}

export function classifyLocalDevInstanceStatus(input: {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: LocalResourceProbe;
	worktree: "present" | "missing";
}): LocalDevInstanceStatus {
	if ([input.bucket, input.database, input.namespace].includes("unknown")) {
		return "unknown";
	}
	if (input.worktree === "missing") {
		return "stale";
	}
	if (input.bucket === "present" && input.database === "present" && input.namespace === "present") {
		return "ready";
	}
	if (input.bucket === "missing" && input.database === "missing" && input.namespace === "missing") {
		return "unprovisioned";
	}
	return "partial";
}

export function localInstanceDestroyPreview(repoRoot: string, instanceId?: string): string {
	let profile = instanceId
		? listLocalDevProfiles(repoRoot).find((item) => item.instanceId === instanceId)
		: undefined;
	if (
		!instanceId &&
		(existsSync(resolveLocalDevProfilePath(repoRoot)) ||
			existsSync(resolveLegacyLocalDevProfilePath(repoRoot)))
	) {
		profile = loadLocalDevProfile(repoRoot);
	}
	if (!profile) {
		return instanceId
			? `Unknown local development instance: ${instanceId}`
			: "This worktree has no local development instance.";
	}
	return [
		formatProfileSummary(profile),
		"No data was changed.",
		`Destroy with: pnpm dev:destroy -- --instance ${profile.instanceId} --confirm ${profile.instanceId}`,
	].join("\n");
}

async function deleteLocalTemporalNamespace(
	repoRoot: string,
	profile: LocalDevProfileV2,
): Promise<void> {
	runCommand(
		"docker",
		[
			"compose",
			"--project-name",
			TEMPORAL_PROJECT,
			"-f",
			"infra/local/docker-compose.dev.yml",
			"exec",
			"-T",
			"temporal",
			"temporal",
			"operator",
			"namespace",
			"delete",
			"--address",
			"temporal:7233",
			"--namespace",
			localTemporalNamespace(profile),
		],
		{ cwd: repoRoot, timeout: TEMPORAL_NAMESPACE_TIMEOUT_MS },
	);
}

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	async function run(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await worker(items[index]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
	return results;
}

type LocalResourceProbe = "present" | "missing" | "unknown";
