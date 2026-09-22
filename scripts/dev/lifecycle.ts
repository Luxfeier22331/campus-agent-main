import { existsSync } from "node:fs";
import {
	type BootstrapProbeResult,
	bootstrapLocalApplications,
	type LocalApplicationBootstrapStep,
	probeLocalBootstrapStep,
} from "./application-bootstrap";
import { localDatabaseProbe } from "./database-roles";
import {
	assertLocalEnvironmentFilesAreManaged,
	ensureLocalModelConfigEncryptionKey,
	importMainCheckoutExternalCredentials,
	isLocalManagedFile,
	isPrivateLocalFile,
	managedLocalEnvironmentPathsForProjections,
	removeLocalEnvironmentFiles,
	removeLocalModelConfigEncryptionKey,
	renderLocalEnvironmentFiles,
	resolveLocalModelConfigEncryptionKeyPath,
	resolveMainCheckoutRoot,
} from "./environment";
import {
	assertDestroyConfirmation,
	destroyLocalInstanceResources,
	ensureLocalInstanceResources,
	ensureLocalTemporalNamespace,
	formatProfileSummary,
	probeLocalTemporalNamespace,
} from "./instance-resources";
import { resolveLocalQdrantConnection } from "./local-qdrant";
import { removeLocalDevSecrets, resolveLocalDevSecretsPath } from "./local-secrets";
import { runCommand } from "./process";
import {
	assertProductAppsOffline,
	diagnoseProductData,
	initializeProductData,
	repairProductSnapshot,
} from "./product-data";
import type { ProductDataOptions } from "./product-data-options";
import { removeProductSnapshot } from "./product-data-state";
import {
	ensureLocalDevProfile,
	type LocalDevProfileV2,
	listLocalDevProfiles,
	loadLocalDevProfile,
	releaseLocalDevProfile,
} from "./profile";
import {
	inspectSharedCapabilities,
	inspectSharedInfrastructure,
	localBucketProbe,
	type SharedCapabilityDiagnosis,
} from "./shared-infrastructure";
import {
	type LocalBootstrapStep,
	type LocalDevEnvironmentProjection,
	type LocalDevTarget,
	type LocalModelConfigName,
	resolveLocalDevTargetPlan,
} from "./targets";

export type LocalDiagnosisStatus = "ready" | "incomplete" | "unknown" | "invalid";
export type LocalDoctorScope = "config" | "runtime" | "shared" | "data";

export interface LocalTargetDiagnosis {
	bootstrap: Partial<Record<LocalApplicationBootstrapStep | "product-data", BootstrapProbeResult>>;
	environment: {
		paths: Record<string, boolean>;
		secrets: boolean;
		modelConfigKey: boolean;
	};
	profile: LocalDevProfileV2;
	resources: {
		bucket: "present" | "missing" | "not-required" | "unknown";
		database: "present" | "missing" | "unknown";
		namespace?: "present" | "missing" | "unknown";
	};
	runtime?: Record<string, "ready" | "missing" | "unknown">;
	shared: SharedCapabilityDiagnosis;
	status: LocalDiagnosisStatus;
	target: LocalDevTarget;
}

export async function initializeLocalDevelopmentTarget(
	repoRoot: string,
	target: LocalDevTarget,
	options: { repair?: boolean } & Partial<ProductDataOptions> = {},
): Promise<LocalDevProfileV2> {
	const plan = resolveLocalDevTargetPlan(target);
	const projections = plan.environmentProjections;
	const productTarget = target === "core" || target === "ops-web";
	if (!productTarget && (options.data === "cluster" || options.replace)) {
		throw new Error("Product data options require --target core or ops-web");
	}
	assertLocalEnvironmentFilesAreManaged(repoRoot, projections);
	const qdrant = projections.some((projection) =>
		["core", "campus-rag-index-publisher", "notice-artifacts-worker"].includes(projection),
	)
		? await resolveLocalQdrantConnection()
		: undefined;

	const profile = await ensureLocalDevProfile(repoRoot);
	if (productTarget) {
		await assertProductAppsOffline(profile);
		if (options.repair) {
			await repairProductSnapshot(repoRoot, profile);
		}
	}
	const shared = await inspectSharedCapabilities({
		derivedBucketName: profile.bucketName,
		required: plan.capabilities,
	});
	assertCapabilitiesForInitialization(shared);
	await ensureLocalInstanceResources(profile, {
		...options,
		ensureBucket: plan.capabilities.includes("derived-bucket"),
	});

	if (projections.some((projection) => ["core", "model-config"].includes(projection))) {
		ensureLocalModelConfigEncryptionKey(repoRoot);
	}
	importMainCheckoutExternalCredentials({
		mainCheckoutRoot: resolveMainCheckoutRoot(repoRoot),
		projections,
		repoRoot,
	});
	renderLocalEnvironmentFiles({ profile, qdrant, repoRoot, target, projections });

	if (plan.bootstrapSteps.includes("temporal-namespace")) {
		await ensureLocalTemporalNamespace(repoRoot, profile);
	}
	const applicationSteps = plan.bootstrapSteps.filter(
		(step): step is Exclude<LocalBootstrapStep, "temporal-namespace"> =>
			step !== "temporal-namespace",
	);
	await bootstrapLocalApplications(
		repoRoot,
		profile,
		applicationSteps.filter(
			(step) => step !== "model-config-check" && step !== "model-config-seed",
		),
		plan.modelConfigNames,
	);
	if (productTarget) {
		await initializeProductData(repoRoot, profile, {
			data: options.data ?? "seed",
			replace: options.replace ?? false,
			context: options.context,
			namespace: options.namespace,
		});
		renderLocalEnvironmentFiles({ profile, qdrant, repoRoot, target, projections });
	}
	await bootstrapLocalApplications(
		repoRoot,
		profile,
		applicationSteps.filter(
			(step) => step === "model-config-seed" || step === "model-config-check",
		),
		plan.modelConfigNames,
	);
	if (target === "notice-pipeline-worker" || target === "notice-artifacts-worker") {
		runCommand("pnpm", ["--filter", "notice-pipeline-worker", "schedule:init"], { cwd: repoRoot });
	}
	console.log(formatProfileSummary(profile));
	return profile;
}

export async function diagnoseLocalDevelopment(
	repoRoot: string,
	target: LocalDevTarget = "core",
	scope: LocalDoctorScope = "config",
): Promise<LocalTargetDiagnosis> {
	const profile = loadLocalDevProfile(repoRoot);
	const plan = resolveLocalDevTargetPlan(target);
	const shared =
		scope === "shared"
			? inspectSharedInfrastructure(repoRoot).then((diagnosis) => ({
					...diagnosis.capabilities,
					required: [...plan.capabilities],
				}))
			: inspectSharedCapabilities({
					derivedBucketName: profile.bucketName,
					required: plan.capabilities,
				});
	let sharedDiagnosis = await shared;
	const database = localDatabaseProbe(profile.databaseName);
	const bucket = plan.capabilities.includes("derived-bucket")
		? await localBucketProbe(profile.bucketName)
		: ("not-required" as const);
	if (plan.capabilities.includes("derived-bucket") && bucket !== "not-required") {
		sharedDiagnosis = { ...sharedDiagnosis, derivedBucket: bucket };
	}
	const paths = managedLocalEnvironmentPathsForProjections(repoRoot, plan.environmentProjections);
	const environmentPaths = Object.fromEntries(
		paths.map((path) => [path, existsSync(path) && isLocalManagedFile(path)]),
	);
	const modelConfigKey =
		!plan.environmentProjections.some((projection) =>
			["core", "model-config"].includes(projection),
		) ||
		(existsSync(resolveLocalModelConfigEncryptionKeyPath(repoRoot)) &&
			isPrivateLocalFile(resolveLocalModelConfigEncryptionKeyPath(repoRoot)));
	const secrets =
		!needsLocalSecrets(plan.environmentProjections) ||
		existsSync(resolveLocalDevSecretsPath(repoRoot));
	const bootstrap: LocalTargetDiagnosis["bootstrap"] = {};
	for (const step of plan.bootstrapSteps) {
		if (step === "temporal-namespace") {
			continue;
		}
		bootstrap[step] = await safeBootstrapProbe(repoRoot, profile, step, plan.modelConfigNames);
	}
	if (target === "core" || target === "ops-web") {
		bootstrap["product-data"] = await diagnoseProductData(repoRoot, profile, scope === "data");
	}
	const namespace = plan.bootstrapSteps.includes("temporal-namespace")
		? await probeLocalTemporalNamespace(repoRoot, profile)
		: undefined;
	const runtime = scope === "runtime" ? await diagnoseRuntime(target, profile) : undefined;
	const status =
		scope === "data"
			? bootstrap["product-data"]?.state === "ready"
				? "ready"
				: "incomplete"
			: classifyDiagnosis({
					bootstrap,
					database,
					environmentPaths,
					modelConfigKey,
					namespace,
					runtime,
					secrets,
					shared: sharedDiagnosis,
					bucket,
				});
	return {
		bootstrap,
		environment: { modelConfigKey, paths: environmentPaths, secrets },
		profile,
		resources: { bucket, database, ...(namespace ? { namespace } : {}) },
		...(runtime ? { runtime } : {}),
		shared: sharedDiagnosis,
		status,
		target,
	};
}

export async function destroyLocalDevelopment(input: {
	confirmation?: string;
	instanceId: string;
	repoRoot: string;
}): Promise<void> {
	assertDestroyConfirmation(input.instanceId, input.confirmation);
	const profile = listLocalDevProfiles(input.repoRoot).find(
		(instance) => instance.instanceId === input.instanceId,
	);
	if (!profile) {
		throw new Error(`Unknown local development instance: ${input.instanceId}`);
	}
	const resources = await destroyLocalInstanceResources(input.repoRoot, profile);
	if (resources.unresolved.length > 0) {
		throw new Error(
			`Partially destroyed local development instance ${input.instanceId}; unable to inspect ${resources.unresolved.join(", ")}. The instance remains registered; retry after the missing dependency is available.`,
		);
	}
	const cleanup = existsSync(profile.worktreePath)
		? removeLocalEnvironmentFiles(profile.worktreePath)
		: { removed: [], skippedUnmanaged: [] };
	if (existsSync(profile.worktreePath)) {
		removeLocalModelConfigEncryptionKey(profile.worktreePath);
	}
	if (existsSync(profile.worktreePath)) {
		removeLocalDevSecrets(profile.worktreePath);
		removeProductSnapshot(profile.worktreePath);
	}
	releaseLocalDevProfile(input.repoRoot, input.instanceId);
	if (cleanup.skippedUnmanaged.length > 0) {
		console.error(`Skipped unmanaged environment files: ${cleanup.skippedUnmanaged.join(", ")}`);
	}
	console.log(`Destroyed local development instance ${input.instanceId}.`);
}

export async function pruneLocalDevelopment(input: {
	confirmation?: string;
	instanceId?: string;
	repoRoot: string;
}): Promise<void> {
	const profiles = listLocalDevProfiles(input.repoRoot);
	const stale = profiles.filter((profile) => !existsSync(profile.worktreePath));
	if (!input.instanceId) {
		console.log(
			stale.length > 0
				? stale
						.map(
							(profile) => `${profile.instanceId}\t${profile.databaseName}\t${profile.bucketName}`,
						)
						.join("\n")
				: "No stale local development instances.",
		);
		return;
	}
	const profile = stale.find((item) => item.instanceId === input.instanceId);
	if (!profile) {
		throw new Error(`Instance is not stale or does not exist: ${input.instanceId}`);
	}
	await destroyLocalDevelopment({
		confirmation: input.confirmation,
		instanceId: profile.instanceId,
		repoRoot: input.repoRoot,
	});
}

function assertCapabilitiesForInitialization(diagnosis: SharedCapabilityDiagnosis): void {
	const locallyOwned = new Set(["derived-bucket", "docs-source"]);
	for (const capability of diagnosis.required) {
		const state =
			diagnosis[
				capability === "derived-bucket"
					? "derivedBucket"
					: capability === "source-bucket"
						? "sourceBucket"
						: capability === "docs-bucket"
							? "docsBucket"
							: capability === "docs-source"
								? "docsSource"
								: capability
			];
		if (locallyOwned.has(capability)) {
			if (state === "unknown") {
				throw new Error(`Local capability ${capability} cannot be inspected.`);
			}
			continue;
		}
		if (state !== "present") {
			throw new Error(
				`Shared capability ${capability} is ${state ?? "unknown"}; run pnpm dev:shared-reconcile from the canonical checkout.`,
			);
		}
	}
}

async function safeBootstrapProbe(
	repoRoot: string,
	profile: LocalDevProfileV2,
	step: Exclude<LocalBootstrapStep, "temporal-namespace">,
	modelConfigNames: readonly LocalModelConfigName[],
): Promise<BootstrapProbeResult> {
	try {
		return await probeLocalBootstrapStep(repoRoot, profile, step, modelConfigNames);
	} catch (error) {
		return { reason: error instanceof Error ? error.message : String(error), state: "unknown" };
	}
}

function classifyDiagnosis(input: {
	bootstrap: LocalTargetDiagnosis["bootstrap"];
	database: "present" | "missing" | "unknown";
	environmentPaths: Record<string, boolean>;
	modelConfigKey: boolean;
	namespace?: "present" | "missing" | "unknown";
	runtime?: Record<string, "ready" | "missing" | "unknown">;
	secrets: boolean;
	shared: SharedCapabilityDiagnosis;
	bucket: "present" | "missing" | "not-required" | "unknown";
}): LocalDiagnosisStatus {
	const sharedStates = input.shared.required.map((capability) => {
		const field =
			capability === "derived-bucket"
				? input.shared.derivedBucket
				: capability === "source-bucket"
					? input.shared.sourceBucket
					: capability === "docs-bucket"
						? input.shared.docsBucket
						: capability === "docs-source"
							? input.shared.docsSource
							: input.shared[capability];
		return field;
	});
	if (Object.values(input.bootstrap).some((probe) => probe?.state === "invalid")) {
		return "invalid";
	}
	if (
		sharedStates.includes("unknown") ||
		input.database === "unknown" ||
		(input.bucket !== "not-required" && input.bucket === "unknown") ||
		input.namespace === "unknown" ||
		Object.values(input.bootstrap).some((probe) => probe?.state === "unknown") ||
		Object.values(input.runtime ?? {}).includes("unknown")
	) {
		return "unknown";
	}
	if (
		sharedStates.includes("missing") ||
		input.database === "missing" ||
		(input.bucket !== "not-required" && input.bucket === "missing") ||
		input.namespace === "missing" ||
		!Object.values(input.environmentPaths).every(Boolean) ||
		!input.secrets ||
		!input.modelConfigKey ||
		Object.values(input.bootstrap).some((probe) => probe?.state === "missing") ||
		Object.values(input.runtime ?? {}).includes("missing")
	) {
		return "incomplete";
	}
	return "ready";
}

async function diagnoseRuntime(
	target: LocalDevTarget,
	profile: LocalDevProfileV2,
): Promise<Record<string, "ready" | "missing" | "unknown">> {
	const core = [
		["app-api", profile.ports.appApi],
		["campus-web", profile.ports.campusWeb],
		["execution-control", 27_051 + profile.slot * 100],
		["model-config", 27_053 + profile.slot * 100],
		["agent-runtime", 27_062 + profile.slot * 100],
	] as const;
	const plan = resolveLocalDevTargetPlan(target);
	const entries: readonly (readonly [string, number])[] = [
		...(target === "core" || plan.runtimeDependencies.includes("core") ? core : []),
		...(target === "ops-web" || plan.runtimeDependencies.includes("ops-web")
			? [["ops-web", profile.ports.opsWebApi] as const]
			: []),
		...(plan.runtimeDependencies.includes("model-config")
			? [["model-config", 27_053 + profile.slot * 100] as const]
			: []),
	];
	const result: Record<string, "ready" | "missing" | "unknown"> = {};
	for (const [name, port] of entries) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
				signal: AbortSignal.timeout(2_000),
			});
			result[name] = response.ok ? "ready" : "missing";
		} catch (error) {
			const code =
				error instanceof Error && "cause" in error
					? (error.cause as { code?: string })?.code
					: undefined;
			result[name] = code === "ECONNREFUSED" ? "missing" : "unknown";
		}
	}
	return result;
}

function needsLocalSecrets(projections: readonly LocalDevEnvironmentProjection[]): boolean {
	return projections.some((projection) =>
		["core", "ops-web", "internal-portal-collection"].includes(projection),
	);
}
