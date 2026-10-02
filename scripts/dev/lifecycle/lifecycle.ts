import { existsSync } from "node:fs";
import {
	assertProductAppsOffline,
	diagnoseProductData,
	initializeProductData,
} from "../product-data/product-data";
import type { ProductDataOptions } from "../product-data/product-data-options";
import { removeProductSnapshot } from "../product-data/product-data-state";
import {
	type BootstrapProbeResult,
	bootstrapLocalApplications,
	type LocalApplicationBootstrapStep,
	probeLocalBootstrapStep,
} from "./application-bootstrap";
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
import { removeLocalInfrastructureSecrets } from "./infrastructure-secrets";
import {
	assertDestroyConfirmation,
	destroyLocalInstanceResources,
	ensureLocalTemporalNamespace,
	formatProfileSummary,
	probeLocalTemporalNamespace,
} from "./instance-resources";
import {
	ensureLocalInfrastructure,
	inspectLocalInfrastructure,
	type LocalCapabilityDiagnosis,
} from "./local-infrastructure";
import { resolveLocalQdrantConnection } from "./local-qdrant";
import { removeLocalDevSecrets, resolveLocalDevSecretsPath } from "./local-secrets";
import { runCommand } from "./process";
import {
	calculateLocalDevRuntimePorts,
	ensureLocalDevProfile,
	type LocalDevProfile,
	listLocalDevProfiles,
	loadLocalDevProfile,
	releaseLocalDevProfile,
} from "./profile";
import {
	type LocalBootstrapStep,
	type LocalDevEnvironmentProjection,
	type LocalDevTarget,
	type LocalModelConfigName,
	resolveLocalDevTargetPlan,
} from "./targets";

export type LocalDiagnosisStatus = "ready" | "incomplete" | "unknown" | "invalid";
export type LocalDoctorScope = "config" | "runtime" | "infra" | "data";

export interface LocalTargetDiagnosis {
	bootstrap: Partial<Record<LocalApplicationBootstrapStep | "product-data", BootstrapProbeResult>>;
	environment: { paths: Record<string, boolean>; secrets: boolean; modelConfigKey: boolean };
	profile: LocalDevProfile;
	resources: {
		bucket: "present" | "missing" | "not-required" | "unknown";
		database: "present" | "missing" | "unknown";
		namespace?: "present" | "missing" | "unknown";
	};
	runtime?: Record<string, "ready" | "missing" | "unknown">;
	infrastructure: LocalCapabilityDiagnosis;
	status: LocalDiagnosisStatus;
	target: LocalDevTarget;
}

export async function initializeLocalDevelopmentTarget(
	repoRoot: string,
	target: LocalDevTarget,
	options: Partial<ProductDataOptions> = {},
): Promise<LocalDevProfile> {
	const plan = resolveLocalDevTargetPlan(target);
	const projections = plan.environmentProjections;
	const productTarget = target === "core" || target === "ops-web";
	if (!productTarget && ((options.data && options.data !== "seed") || options.replace)) {
		throw new Error("Product data options require --target core or ops-web");
	}
	assertLocalEnvironmentFilesAreManaged(repoRoot, projections);
	const profile = await ensureLocalDevProfile(repoRoot);
	if (productTarget) {
		await assertProductAppsOffline(profile);
	}
	// Product initialization creates the Docs source object after the data plane is
	// ready. Provision the services and buckets first, then let product-data
	// initialization validate and publish the source/index closure.
	const infrastructureCapabilities = productTarget
		? plan.capabilities.filter((capability) => capability !== "docs-source")
		: plan.capabilities;
	importMainCheckoutExternalCredentials({
		mainCheckoutRoot: resolveMainCheckoutRoot(repoRoot),
		projections,
		repoRoot,
	});
	await ensureLocalInfrastructure(repoRoot, profile, infrastructureCapabilities);
	const qdrant = plan.capabilities.includes("qdrant")
		? await resolveLocalQdrantConnection(repoRoot, profile)
		: undefined;
	if (projections.some((projection) => ["core", "model-config"].includes(projection))) {
		ensureLocalModelConfigEncryptionKey(repoRoot);
	}
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
			...(options.noticeLimit === undefined ? {} : { noticeLimit: options.noticeLimit }),
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
	const infrastructure = await inspectLocalInfrastructure(repoRoot, profile, plan.capabilities);
	const database = infrastructure.capabilities.postgres ?? "unknown";
	const bucket =
		plan.capabilities.includes("derived-bucket") || plan.capabilities.includes("docs-bucket")
			? (infrastructure.capabilities.derivedBucket ?? "unknown")
			: "not-required";
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
		if (step !== "temporal-namespace") {
			bootstrap[step] = await safeBootstrapProbe(repoRoot, profile, step, plan.modelConfigNames);
		}
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
					infrastructure: infrastructure.capabilities,
					bucket,
				});
	return {
		bootstrap,
		environment: { modelConfigKey, paths: environmentPaths, secrets },
		profile,
		resources: { bucket, database, ...(namespace ? { namespace } : {}) },
		...(runtime ? { runtime } : {}),
		infrastructure: infrastructure.capabilities,
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
			`Partially destroyed local development instance ${input.instanceId}; unable to inspect ${resources.unresolved.join(", ")}.`,
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
	}
	if (existsSync(profile.worktreePath)) {
		removeProductSnapshot(profile.worktreePath);
	}
	removeLocalInfrastructureSecrets(input.repoRoot, profile);
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

async function safeBootstrapProbe(
	repoRoot: string,
	profile: LocalDevProfile,
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
	infrastructure: LocalCapabilityDiagnosis;
	bucket: "present" | "missing" | "not-required" | "unknown";
}): LocalDiagnosisStatus {
	const states = Object.entries(input.infrastructure)
		.filter(([key]) => key !== "required")
		.map(([, value]) => value);
	if (Object.values(input.bootstrap).some((probe) => probe?.state === "invalid")) {
		return "invalid";
	}
	if (
		states.includes("unknown") ||
		input.database === "unknown" ||
		input.bucket === "unknown" ||
		input.namespace === "unknown" ||
		Object.values(input.bootstrap).some((probe) => probe?.state === "unknown") ||
		Object.values(input.runtime ?? {}).includes("unknown")
	) {
		return "unknown";
	}
	if (
		states.includes("missing") ||
		input.database === "missing" ||
		input.bucket === "missing" ||
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
	profile: LocalDevProfile,
): Promise<Record<string, "ready" | "missing" | "unknown">> {
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	const plan = resolveLocalDevTargetPlan(target);
	const entries: Array<readonly [string, number]> = [];
	if (target === "core" || plan.runtimeDependencies.includes("core")) {
		entries.push(
			["app-api", profile.ports.appApi],
			["campus-web", profile.ports.campusWeb],
			["execution-control", runtimePorts.executionControl],
			["execution-worker", runtimePorts.executionWorker],
			["model-config", runtimePorts.modelConfig],
			["agent-runtime", runtimePorts.agentRuntime],
		);
	}
	if (target === "ops-web" || plan.runtimeDependencies.includes("ops-web")) {
		entries.push(["ops-web", profile.ports.opsWebApi]);
	}
	if (plan.runtimeDependencies.includes("model-config")) {
		entries.push(["model-config", runtimePorts.modelConfig]);
	}
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
