import { existsSync } from "node:fs";

import { localDatabaseProbe } from "./database-roles";
import { loadLocalInfrastructureSecrets } from "./infrastructure-secrets";
import {
	inspectLocalInfrastructure,
	type LocalResourceProbe,
	localComposeArgs,
	removeLocalInfrastructure,
} from "./local-infrastructure";
import { captureCommandResult, runCommand } from "./process";
import {
	calculateLocalDevRuntimePorts,
	type LocalDevProfile,
	listLocalDevProfiles,
	loadLocalDevProfile,
	resolveLegacyLocalDevProfilePath,
	resolveLocalDevProfilePath,
} from "./profile";
import type { LocalDevCapability } from "./targets";

const TEMPORAL_NAMESPACE_TIMEOUT_MS = 10_000;

export type LocalDevInstanceStatus =
	| "ready"
	| "stale"
	| "partial"
	| "unprovisioned"
	| "unknown"
	| "registered";

export interface LocalDevInstanceDiagnosis {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: "present" | "missing" | "unknown";
	profile: LocalDevProfile;
	status: LocalDevInstanceStatus;
	worktree: "present" | "missing";
}

export interface LocalInstanceResourceCleanup {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: "present" | "missing" | "unknown";
	unresolved: Array<"bucket" | "database" | "namespace">;
}

export interface LocalInstanceResourceCleanupPlan {
	deleteBucket: boolean;
	deleteDatabase: boolean;
	deleteNamespace: boolean;
	unresolved: Array<"bucket" | "database" | "namespace">;
}

export function assertDestroyConfirmation(instanceId: string, confirmation?: string): void {
	if (confirmation !== instanceId) {
		throw new Error(`Destruction requires --confirm ${instanceId}.`);
	}
}

export function resolveLocalInstanceResourceCleanup(input: {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: "present" | "missing" | "unknown";
}): LocalInstanceResourceCleanupPlan {
	return {
		deleteBucket: input.bucket === "present",
		deleteDatabase: input.database === "present",
		deleteNamespace: input.namespace === "present",
		unresolved: [
			...(input.database === "unknown" ? ["database" as const] : []),
			...(input.bucket === "unknown" ? ["bucket" as const] : []),
			...(input.namespace === "unknown" ? ["namespace" as const] : []),
		],
	};
}

export function localTemporalNamespace(profile: LocalDevProfile): string {
	return `campus-agent-local-${profile.instanceId}`;
}

export async function probeLocalTemporalNamespace(
	repoRoot: string,
	profile: LocalDevProfile,
): Promise<"present" | "missing" | "unknown"> {
	const result = captureCommandResult(
		"docker",
		[
			...localComposeArgs(repoRoot, profile),
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
	profile: LocalDevProfile,
): Promise<void> {
	const state = await probeLocalTemporalNamespace(repoRoot, profile);
	if (state === "present") {
		return;
	}
	if (state === "unknown") {
		throw new Error(`Unable to inspect Temporal namespace ${localTemporalNamespace(profile)}.`);
	}
	runCommand(
		"docker",
		[
			...localComposeArgs(repoRoot, profile),
			"exec",
			"-T",
			"temporal",
			"temporal",
			"operator",
			"namespace",
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
	profile: LocalDevProfile,
): Promise<LocalInstanceResourceCleanup> {
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	const database = localDatabaseProbe(profile, secrets.postgresPassword);
	const bucket = await localBucketProbe(repoRoot, profile, profile.bucketName);
	const namespace = await probeLocalTemporalNamespace(repoRoot, profile);
	const plan = resolveLocalInstanceResourceCleanup({ bucket, database, namespace });
	if (plan.unresolved.length > 0) {
		return { bucket, database, namespace, unresolved: plan.unresolved };
	}
	if (profile.infraProject) {
		removeLocalInfrastructure(repoRoot, profile);
	}
	return { bucket: "missing", database: "missing", namespace: "missing", unresolved: [] };
}

export function formatProfileSummary(profile: LocalDevProfile): string {
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	return [
		`Local instance: ${profile.instanceId}`,
		`Compose project: ${profile.infraProject}`,
		`Campus Web: http://127.0.0.1:${profile.ports.campusWeb}`,
		`app-api: http://127.0.0.1:${profile.ports.appApi}`,
		`Ops Web: http://127.0.0.1:${profile.ports.opsWeb}/dining`,
		`Execution Control: http://127.0.0.1:${runtimePorts.executionControl}`,
		`Model Config: http://127.0.0.1:${runtimePorts.modelConfig}`,
		`Agent Runtime: http://127.0.0.1:${runtimePorts.agentRuntime}`,
		`PostgreSQL: 127.0.0.1:${profile.infraPorts.postgres}`,
		`Object store: 127.0.0.1:${profile.infraPorts.objectStore}`,
		`Qdrant: 127.0.0.1:${profile.infraPorts.qdrantHttp}`,
		`Temporal: 127.0.0.1:${profile.infraPorts.temporal}`,
		`Temporal namespace: ${localTemporalNamespace(profile)}`,
		`Database: ${profile.databaseName}`,
		`Source bucket: ${profile.sourceBucketName}`,
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
	return await Promise.all(
		profiles.map(async (profile) => {
			if (!profile.infraProject) {
				return {
					bucket: "unknown",
					database: "unknown",
					namespace: "unknown",
					profile,
					status: "unknown",
					worktree: existsSync(profile.worktreePath) ? "present" : "missing",
				};
			}
			const diagnosis = await inspectLocalInfrastructure(repoRoot, profile, [
				"postgres",
				"derived-bucket",
				"temporal",
			] satisfies LocalDevCapability[]);
			const worktree = existsSync(profile.worktreePath) ? "present" : "missing";
			const bucket = diagnosis.capabilities.derivedBucket ?? "unknown";
			const database = diagnosis.capabilities.postgres ?? "unknown";
			const namespace = await probeLocalTemporalNamespace(repoRoot, profile);
			return {
				bucket,
				database,
				namespace,
				profile,
				status: classifyLocalDevInstanceStatus({ bucket, database, namespace, worktree }),
				worktree,
			};
		}),
	);
}

export function classifyLocalDevInstanceStatus(input: {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	namespace: "present" | "missing" | "unknown";
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
