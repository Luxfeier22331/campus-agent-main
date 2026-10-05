import { existsSync } from "node:fs";
import { removeProductSnapshot } from "../product-data/product-data-state";
import {
	assertLocalEnvironmentFilesAreManaged,
	removeLocalEnvironmentFiles,
	removeLocalModelConfigEncryptionKey,
} from "./environment";
import { removeLocalInfrastructureSecrets } from "./infrastructure-secrets";
import {
	assertDestroyConfirmation,
	destroyLocalInstanceResources,
	formatProfileSummary,
} from "./instance-resources";
import { removeLocalDevSecrets } from "./local-secrets";
import { prepareEnvironment, prepareInfrastructure, prepareRecords } from "./operations";
import {
	ensureLocalDevProfile,
	type LocalDevProfile,
	listLocalDevProfiles,
	releaseLocalDevProfile,
} from "./profile";
import { type LocalDevTarget, resolveLocalDevTargetPlan } from "./targets";

export { diagnoseLocalDevelopment, type LocalDoctorScope } from "./diagnosis";

export async function initializeLocalDevelopmentTarget(
	repoRoot: string,
	target: LocalDevTarget,
): Promise<LocalDevProfile> {
	assertLocalEnvironmentFilesAreManaged(
		repoRoot,
		resolveLocalDevTargetPlan(target).environmentProjections,
	);
	const profile = await ensureLocalDevProfile(repoRoot);
	prepareEnvironment(repoRoot, profile, target);
	await prepareInfrastructure(repoRoot, profile, target);
	await prepareRecords(repoRoot, profile, target);
	console.log(formatProfileSummary(profile));
	return profile;
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
	await destroyLocalInstanceResources(input.repoRoot, profile);
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
