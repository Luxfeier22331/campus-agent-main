import { existsSync, readFileSync } from "node:fs";

import { bootstrapLocalApplications } from "./application-bootstrap";
import {
	assertLocalEnvironmentFilesAreManaged,
	ensureLocalLegacyProviderConfigEncryptionKey,
	ensureLocalModelConfigEncryptionKey,
	type LocalDevEnvironmentTarget,
	MANAGED_LOCAL_ENV_MARKER,
	managedLocalEnvironmentPathsForTarget,
	removeLocalEnvironmentFiles,
	renderLocalEnvironmentFiles,
} from "./environment";
import {
	assertDestroyConfirmation,
	destroyLocalInstanceResources,
	ensureLocalInstanceResources,
	ensureLocalTemporalNamespace,
	formatProfileSummary,
	localDatabaseProbe,
} from "./instance-resources";
import {
	ensureLocalDevProfile,
	type LocalDevProfileV1,
	listLocalDevProfiles,
	loadLocalDevProfile,
	releaseLocalDevProfile,
} from "./profile";
import {
	assertSharedDataInfrastructureReady,
	DOCS_BUCKET,
	DOCS_SOURCE_KEY,
	ensureSharedInfrastructure,
	inspectSharedInfrastructure,
	type LocalResourceProbe,
	localBucketProbe,
	localObjectProbe,
	type SharedInfrastructureDiagnosis,
	SOURCE_BUCKET,
} from "./shared-infrastructure";

export function initializeLocalDevelopmentTarget(
	repoRoot: string,
	target: Exclude<LocalDevEnvironmentTarget, "all">,
): LocalDevProfileV1 {
	assertLocalEnvironmentFilesAreManaged(repoRoot, target);
	ensureSharedInfrastructure(repoRoot);
	const profile = ensureLocalDevProfile(repoRoot);
	ensureLocalInstanceResources(profile);
	if (target === "core") {
		ensureLocalLegacyProviderConfigEncryptionKey(repoRoot);
		ensureLocalModelConfigEncryptionKey(repoRoot);
	}
	renderLocalEnvironmentFiles({ profile, repoRoot, target });
	if (target === "core") {
		ensureLocalTemporalNamespace(repoRoot, profile);
	}
	if (
		target === "core" ||
		target === "ops-web" ||
		target === "ingestion-control" ||
		target === "notice-publisher"
	) {
		bootstrapLocalApplications(repoRoot, profile, target);
	}
	console.log(formatProfileSummary(profile));
	return profile;
}

export function diagnoseLocalDevelopment(repoRoot: string): {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	docsBucket: LocalResourceProbe;
	docsSource: LocalResourceProbe;
	managedEnvironmentReady: boolean;
	profile: LocalDevProfileV1;
	sharedInfrastructure: SharedInfrastructureDiagnosis;
	sourceBucket: LocalResourceProbe;
} {
	const profile = loadLocalDevProfile(repoRoot);
	const sharedInfrastructure = inspectSharedInfrastructure(repoRoot);
	const managedEnvironmentReady = managedLocalEnvironmentPathsForTarget(repoRoot, "core").every(
		(absolutePath) =>
			existsSync(absolutePath) &&
			readFileSync(absolutePath, "utf8").startsWith(MANAGED_LOCAL_ENV_MARKER),
	);
	const resources = sharedInfrastructure.status === "ready";
	return {
		bucket: resources ? localBucketProbe(profile.bucketName) : "unknown",
		database: resources ? localDatabaseProbe(profile.databaseName) : "unknown",
		docsBucket: resources ? localBucketProbe(DOCS_BUCKET) : "unknown",
		docsSource: resources ? localObjectProbe(DOCS_BUCKET, DOCS_SOURCE_KEY) : "unknown",
		managedEnvironmentReady,
		profile,
		sharedInfrastructure,
		sourceBucket: resources ? localBucketProbe(SOURCE_BUCKET) : "unknown",
	};
}

export function destroyLocalDevelopment(input: {
	confirmation?: string;
	instanceId: string;
	repoRoot: string;
}): void {
	assertDestroyConfirmation(input.instanceId, input.confirmation);
	const profile = listLocalDevProfiles(input.repoRoot).find(
		(instance) => instance.instanceId === input.instanceId,
	);
	if (!profile) {
		throw new Error(`Unknown local development instance: ${input.instanceId}`);
	}
	if (existsSync(profile.worktreePath)) {
		assertLocalEnvironmentFilesAreManaged(profile.worktreePath);
	}
	assertSharedDataInfrastructureReady(input.repoRoot);
	destroyLocalInstanceResources(profile);
	if (existsSync(profile.worktreePath)) {
		removeLocalEnvironmentFiles(profile.worktreePath);
	}
	releaseLocalDevProfile(input.repoRoot, input.instanceId);
	console.log(`Destroyed local development instance ${input.instanceId}.`);
}
