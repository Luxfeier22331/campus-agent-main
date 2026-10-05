import { dirname, resolve } from "node:path";

import { ensureLocalDatabase, localDatabaseProbe } from "./database-roles";
import {
	ensureLocalInfrastructureSecrets,
	type LocalInfrastructureSecrets,
	loadLocalInfrastructureSecrets,
	resolveLocalInfrastructureSecretsPath,
} from "./infrastructure-secrets";
import { assertLocalHindsightProviders, localHindsightEnvironment } from "./local-hindsight";
import { type LocalResourceProbe, probeLocalBucket, probeLocalObject } from "./local-object-store";
import { resolveLocalQdrantConnection } from "./local-qdrant";
import { withLifecycleLock } from "./locks";
import { captureCommandResult, runCommand } from "./process";
import { type LocalDevProfile, resolveLocalDevRegistryPath } from "./profile";
import type { LocalDevCapability } from "./targets";

export const DOCS_SOURCE_KEY = "campus-docs/source.json";

const LOCK_FILENAME = "infrastructure.lock";
const OBJECT_STORE_CLI_IMAGE =
	"rustfs/rc:v0.1.30@sha256:1296510ec27800668d26a8bdca6251e587086187a9368c7b80134a169e8a3bb8";

export interface LocalCapabilityDiagnosis {
	derivedBucket?: LocalResourceProbe;
	docsSource?: LocalResourceProbe;
	objectStore?: LocalResourceProbe;
	postgres?: LocalResourceProbe;
	qdrant?: LocalResourceProbe;
	required: LocalDevCapability[];
	sourceBucket?: LocalResourceProbe;
	temporal?: LocalResourceProbe;
	hindsight?: LocalResourceProbe;
}

export interface LocalInfrastructureDiagnosis {
	capabilities: LocalCapabilityDiagnosis;
	status: "ready" | "missing" | "unhealthy" | "unknown";
	services: Record<string, { running: boolean; healthy: boolean; probe: LocalResourceProbe }>;
}

export function localComposeArgs(repoRoot: string, profile: LocalDevProfile): string[] {
	return [
		"compose",
		"--project-name",
		profile.infraProject,
		"--env-file",
		resolveLocalInfrastructureSecretsPath(repoRoot, profile),
		"-f",
		"infra/local/docker-compose.dev.yml",
		"-f",
		"infra/local/docker-compose.execution-runtime.yml",
	];
}

export async function ensureLocalInfrastructure(
	repoRoot: string,
	profile: LocalDevProfile,
	required: readonly LocalDevCapability[],
): Promise<void> {
	const lockPath = resolve(
		dirname(resolveLocalDevRegistryPath(repoRoot)),
		`${profile.instanceId}-${LOCK_FILENAME}`,
	);
	await withLifecycleLock(lockPath, "local-infrastructure", async () => {
		const secrets = ensureLocalInfrastructureSecrets(repoRoot, profile);
		const services = servicesForCapabilities(required);
		if (required.includes("hindsight")) {
			assertLocalHindsightProviders(localHindsightEnvironment(repoRoot));
		}
		if (services.length > 0) {
			runCommand(
				"docker",
				[...localComposeArgs(repoRoot, profile), "up", "-d", "--wait", ...services],
				{
					cwd: repoRoot,
					env: { ...composeEnvironment(profile, secrets), ...localHindsightEnvironment(repoRoot) },
					timeout: 180_000,
				},
			);
		}
		if (required.includes("postgres")) {
			ensureLocalDatabase(profile, secrets.postgresPassword);
		}
		if (
			required.some((value) => ["derived-bucket", "docs-bucket", "docs-source"].includes(value))
		) {
			ensureBucket(repoRoot, profile, secrets, profile.bucketName);
		}
		if (required.includes("source-bucket")) {
			ensureBucket(repoRoot, profile, secrets, profile.sourceBucketName);
		}
		const diagnosis = await inspectLocalInfrastructure(repoRoot, profile, required);
		if (diagnosis.status !== "ready") {
			throw new Error(`Local infrastructure did not become ready (status=${diagnosis.status}).`);
		}
	});
}

export async function inspectLocalInfrastructure(
	repoRoot: string,
	profile: LocalDevProfile,
	required: readonly LocalDevCapability[] = [],
): Promise<LocalInfrastructureDiagnosis> {
	const relevantServices = servicesForCapabilities(required).flatMap((service) =>
		service === "temporal"
			? ["temporal-postgres", "temporal"]
			: service === "hindsight-api"
				? ["hindsight-postgres", "hindsight-api"]
				: [service],
	);
	const services = Object.fromEntries(
		relevantServices.map((service) => [service, inspectService(repoRoot, profile, service)]),
	);
	const capabilities: LocalCapabilityDiagnosis = { required: [...new Set(required)] };
	const secrets = safeLoadSecrets(repoRoot, profile);
	if (required.includes("postgres")) {
		capabilities.postgres = secrets
			? localDatabaseProbe(profile, secrets.postgresPassword)
			: "unknown";
	}
	if (
		required.some((value) =>
			["derived-bucket", "docs-bucket", "docs-source", "source-bucket"].includes(value),
		)
	) {
		capabilities.objectStore = services["object-store"].probe;
	}
	if (required.includes("qdrant")) {
		capabilities.qdrant = secrets
			? await resolveLocalQdrantConnection(repoRoot, profile)
					.then(() => "present" as const)
					.catch(() => "unknown" as const)
			: "unknown";
	}
	if (required.includes("temporal")) {
		capabilities.temporal = services.temporal.probe;
	}
	if (required.includes("hindsight")) {
		const service = services["hindsight-api"];
		capabilities.hindsight =
			service.running && service.healthy
				? "present"
				: service.probe === "missing"
					? "missing"
					: "unknown";
	}
	if (secrets && capabilities.objectStore === "present") {
		if (required.includes("source-bucket")) {
			capabilities.sourceBucket = await probeLocalBucket(
				profile,
				secrets,
				profile.sourceBucketName,
			);
		}
		if (required.includes("derived-bucket") || required.includes("docs-bucket")) {
			capabilities.derivedBucket = await probeLocalBucket(profile, secrets, profile.bucketName);
		}
		if (required.includes("docs-source")) {
			capabilities.docsSource = await probeLocalObject(
				profile,
				secrets,
				profile.bucketName,
				DOCS_SOURCE_KEY,
			);
		}
	}

	const serviceValues = relevantServices.map((service) => services[service]);
	const states = [
		...serviceValues.map((value) => value.probe),
		...Object.entries(capabilities)
			.filter(([key]) => key !== "required")
			.map(([, value]) => value),
	];
	const status = states.includes("unknown")
		? "unknown"
		: states.includes("missing")
			? "missing"
			: serviceValues.some((value) => !(value.running && value.healthy))
				? "unhealthy"
				: "ready";
	return { capabilities, services, status };
}

export async function localBucketProbe(
	repoRoot: string,
	profile: LocalDevProfile,
	bucketName: string,
): Promise<LocalResourceProbe> {
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	return probeLocalBucket(profile, secrets, bucketName);
}

export function objectStoreCommand(
	profile: LocalDevProfile,
	bucketName: string,
	action: "create" | "remove",
	secrets: LocalInfrastructureSecrets,
): string[] {
	let script =
		action === "create"
			? 'rc mb --ignore-existing "local/$BUCKET"'
			: 'rc rb --force "local/$BUCKET"';
	if (action === "create" && bucketName === profile.bucketName) {
		// Match the deployed bucket policy used by App API's unsigned floorplan reads.
		const policy = JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Principal: { AWS: ["*"] },
					Action: ["s3:GetObject"],
					Resource: [`arn:aws:s3:::${bucketName}/dining/floorplans/*`],
				},
			],
		});
		script += `\nprintf '%s' ${shell(policy)} | rc anonymous set-json /dev/stdin "local/$BUCKET"`;
	}
	return [
		"run",
		"--rm",
		"--network",
		`${profile.infraProject}_data-plane`,
		"--env",
		`BUCKET=${bucketName}`,
		"--entrypoint",
		"/bin/sh",
		OBJECT_STORE_CLI_IMAGE,
		"-ec",
		`rc alias set local http://object-store:9000 ${shell(secrets.objectStoreAccessKey)} ${shell(secrets.objectStoreSecretKey)} >/dev/null; ${script}`,
	];
}

export function removeLocalInfrastructure(repoRoot: string, profile: LocalDevProfile): void {
	if (!profile.infraProject) {
		return;
	}
	// `down` 按 project label 删除容器、卷和网络，不需要实例凭据，
	// 因此不传 --env-file 和需要插值的 compose 文件。
	runCommand(
		"docker",
		["compose", "--project-name", profile.infraProject, "down", "--volumes", "--remove-orphans"],
		{ cwd: repoRoot, timeout: 120_000 },
	);
}

function servicesForCapabilities(required: readonly LocalDevCapability[]): string[] {
	const services = new Set<string>();
	if (required.includes("hindsight")) {
		services.add("hindsight-api");
	}
	if (required.includes("postgres")) {
		services.add("postgres");
	}
	if (
		required.some((value) =>
			["derived-bucket", "source-bucket", "docs-bucket", "docs-source"].includes(value),
		)
	) {
		services.add("object-store");
	}
	if (required.includes("qdrant")) {
		services.add("qdrant");
	}
	if (required.includes("temporal")) {
		services.add("temporal");
	}
	return [...services];
}

function inspectService(repoRoot: string, profile: LocalDevProfile, service: string) {
	const result = captureCommandResult(
		"docker",
		[...localComposeArgs(repoRoot, profile), "ps", "-q", service],
		{ cwd: repoRoot },
	);
	if (result.status !== 0 || result.error || result.timedOut || !result.stdout.trim()) {
		return { healthy: false, probe: "missing" as const, running: false };
	}
	const id = result.stdout.trim();
	const inspection = captureCommandResult("docker", ["inspect", "--format", "{{json .}}", id]);
	if (inspection.status !== 0 || inspection.error || inspection.timedOut) {
		return { healthy: false, probe: "unknown" as const, running: false };
	}
	try {
		const value = JSON.parse(inspection.stdout) as {
			State?: { Health?: { Status?: string }; Status?: string };
		};
		return {
			healthy: value.State?.Health?.Status === "healthy",
			probe: "present" as const,
			running: value.State?.Status === "running",
		};
	} catch {
		return { healthy: false, probe: "unknown" as const, running: false };
	}
}

function composeEnvironment(
	profile: LocalDevProfile,
	secrets: LocalInfrastructureSecrets,
): NodeJS.ProcessEnv {
	return {
		...process.env,
		INFRA_HOST: "127.0.0.1",
		POSTGRES_PORT: String(profile.infraPorts.postgres),
		OBJECT_STORE_PORT: String(profile.infraPorts.objectStore),
		OBJECT_STORE_CONSOLE_PORT: String(profile.infraPorts.objectStoreConsole),
		TEMPORAL_PORT: String(profile.infraPorts.temporal),
		TEMPORAL_UI_PORT: String(profile.infraPorts.temporalUi),
		QDRANT_HTTP_PORT: String(profile.infraPorts.qdrantHttp),
		QDRANT_GRPC_PORT: String(profile.infraPorts.qdrantGrpc),
		POSTGRES_PASSWORD: secrets.postgresPassword,
		RUSTFS_ACCESS_KEY: secrets.objectStoreAccessKey,
		RUSTFS_SECRET_KEY: secrets.objectStoreSecretKey,
		TEMPORAL_POSTGRES_PASSWORD: secrets.temporalPostgresPassword,
		QDRANT_API_KEY: secrets.qdrantApiKey,
		QDRANT_READ_ONLY_API_KEY: secrets.qdrantReadOnlyApiKey,
		HINDSIGHT_API_TENANT_API_KEY: secrets.hindsightTenantKey,
		HINDSIGHT_POSTGRES_PASSWORD: secrets.hindsightPostgresPassword,
		HINDSIGHT_API_HOST_PORT: `127.0.0.1:${profile.infraPorts.hindsightApi}`,
	};
}

function ensureBucket(
	repoRoot: string,
	profile: LocalDevProfile,
	secrets: LocalInfrastructureSecrets,
	bucketName: string,
): void {
	runCommand("docker", objectStoreCommand(profile, bucketName, "create", secrets), {
		cwd: repoRoot,
	});
}

function safeLoadSecrets(
	repoRoot: string,
	profile: LocalDevProfile,
): LocalInfrastructureSecrets | undefined {
	try {
		return loadLocalInfrastructureSecrets(repoRoot, profile);
	} catch {
		return undefined;
	}
}

function shell(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
