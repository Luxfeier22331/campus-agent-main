import { existsSync } from "node:fs";
import { bootstrapLocalApplications } from "./application-bootstrap";
import {
	ensureLocalModelConfigEncryptionKey,
	importMainCheckoutExternalCredentials,
	renderLocalEnvironmentFiles,
	resolveLocalModelConfigEncryptionKeyPath,
	resolveMainCheckoutRoot,
} from "./environment";
import { ensureLocalInfrastructureSecrets } from "./infrastructure-secrets";
import { ensureLocalTemporalNamespace } from "./instance-resources";
import { ensureLocalInfrastructure } from "./local-infrastructure";
import { localQdrantConnection } from "./local-qdrant";
import { runCommand } from "./process";
import type { LocalDevProfile } from "./profile";
import {
	type LocalDevTarget,
	type LocalModelConfigName,
	resolveLocalDevTargetPlan,
} from "./targets";

export function prepareEnvironment(
	repoRoot: string,
	profile: LocalDevProfile,
	target: LocalDevTarget,
) {
	const plan = resolveLocalDevTargetPlan(target);
	ensureLocalInfrastructureSecrets(repoRoot, profile);
	if (plan.environmentProjections.some((p) => p === "core" || p === "model-config")) {
		ensureLocalModelConfigEncryptionKey(repoRoot);
	}
	return renderLocalEnvironmentFiles({
		repoRoot,
		profile,
		target,
		qdrant: plan.capabilities.includes("qdrant")
			? localQdrantConnection(repoRoot, profile)
			: undefined,
	});
}
export async function prepareInfrastructure(
	repoRoot: string,
	profile: LocalDevProfile,
	target: LocalDevTarget,
) {
	const plan = resolveLocalDevTargetPlan(target);
	await ensureLocalInfrastructure(repoRoot, profile, plan.capabilities);
	if (plan.capabilities.includes("temporal")) {
		await ensureLocalTemporalNamespace(repoRoot, profile);
	}
}
export async function prepareSchema(repoRoot: string, profile: LocalDevProfile) {
	return bootstrapLocalApplications(repoRoot, profile, ["campus-agent-schema"]);
}
export async function prepareRecords(
	repoRoot: string,
	profile: LocalDevProfile,
	target: LocalDevTarget,
) {
	return bootstrapLocalApplications(
		repoRoot,
		profile,
		resolveLocalDevTargetPlan(target).bootstrapSteps.filter((s) => s !== "temporal-namespace"),
	);
}
export function importCredentials(repoRoot: string, target: LocalDevTarget) {
	importMainCheckoutExternalCredentials({
		repoRoot,
		mainCheckoutRoot: resolveMainCheckoutRoot(repoRoot),
		projections: resolveLocalDevTargetPlan(target).environmentProjections,
	});
}
export async function seedModels(
	repoRoot: string,
	profile: LocalDevProfile,
	target: LocalDevTarget,
	names?: readonly LocalModelConfigName[],
) {
	const selected = names ?? resolveLocalDevTargetPlan(target).modelConfigNames;
	if (selected.length === 0) {
		throw new Error(
			`No model configurations are owned by ${target}; select a consumer target or --name.`,
		);
	}
	if (!existsSync(resolveLocalModelConfigEncryptionKeyPath(repoRoot))) {
		throw new Error(
			"Model Config is not initialized. Run pnpm dev:init -- --target <consumer> before models seed.",
		);
	}
	return bootstrapLocalApplications(repoRoot, profile, ["model-config-seed"], selected);
}
export function initializeSchedule(
	repoRoot: string,
	profile: LocalDevProfile,
	target: LocalDevTarget,
) {
	if (target !== "notice-pipeline-worker") {
		throw new Error("Only notice-pipeline-worker owns a schedule.");
	}
	runCommand("pnpm", ["--filter", "notice-pipeline-worker", "schedule:init"], {
		cwd: repoRoot,
		env: {
			...process.env,
			TEMPORAL_ADDRESS: `127.0.0.1:${profile.infraPorts.temporal}`,
			TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
		},
	});
}
