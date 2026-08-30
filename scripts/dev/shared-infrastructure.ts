import { dirname, resolve } from "node:path";
import { ensureSharedDatabaseRoles } from "./database-roles";
import { probeLocalBucket, probeLocalObject } from "./local-object-store";
import { withLifecycleLock } from "./locks";
import { type LocalPortProbe, probeLocalPort } from "./ports";
import { captureCommandResult, commandSucceeds, runCommand } from "./process";
import { isMainWorktree, resolveLocalDevRegistryPath } from "./profile";
import type { LocalDevCapability } from "./targets";

const COMPOSE_PROJECT = "campus-agent-local";
const DATA_NETWORK = "campus-agent-data-plane";
const POSTGRES_VOLUME = "local_postgres-data";
const OBJECT_STORE_VOLUME = "local_object-store-data";
const TEMPORAL_VOLUME = "local_temporal-shared-postgres-data";
const SHARED_LOCK_FILENAME = "shared-reconcile.lock";
const SHARED_HEALTH_TIMEOUT_MS = 3_000;
const SHARED_RECONCILE_TIMEOUT_MS = 120_000;

export const SOURCE_BUCKET = "campus-agent-source";
export const DOCS_BUCKET = "campus-agent-derived";
export const DOCS_SOURCE_KEY = "campus-docs/source.json";
const OBJECT_STORE_CLI_IMAGE =
	"rustfs/rc:v0.1.30@sha256:1296510ec27800668d26a8bdca6251e587086187a9368c7b80134a169e8a3bb8";

const SHARED_CONTAINERS = {
	objectStore: {
		container: `${COMPOSE_PROJECT}-object-store-1`,
		service: "object-store",
	},
	postgres: {
		container: `${COMPOSE_PROJECT}-postgres-1`,
		service: "postgres",
	},
	temporalPostgres: {
		container: `${COMPOSE_PROJECT}-temporal-postgres-1`,
		service: "temporal-postgres",
	},
	temporal: {
		container: `${COMPOSE_PROJECT}-temporal-1`,
		service: "temporal",
	},
} as const;

export type LocalResourceProbe = "present" | "missing" | "unknown";
export type SharedInfrastructureStatus = "ready" | "missing" | "unhealthy" | "drifted" | "unknown";
export type SharedInfrastructureAction = "reuse" | "reconcile" | "reject";

export interface SharedCapabilityDiagnosis {
	derivedBucket?: LocalResourceProbe;
	docsBucket?: LocalResourceProbe;
	docsSource?: LocalResourceProbe;
	objectStore?: LocalResourceProbe;
	postgres?: LocalResourceProbe;
	required: LocalDevCapability[];
	sourceBucket?: LocalResourceProbe;
	temporal?: LocalResourceProbe;
}

export interface SharedContainerDiagnosis {
	probe: LocalResourceProbe;
	running: boolean;
	healthy: boolean;
	project?: string;
	service?: string;
	configHash?: string;
}

export interface SharedInfrastructureDiagnosis {
	capabilities: SharedCapabilityDiagnosis;
	status: SharedInfrastructureStatus;
	containers: {
		objectStore: SharedContainerDiagnosis;
		postgres: SharedContainerDiagnosis;
		temporalPostgres: SharedContainerDiagnosis;
		temporal: SharedContainerDiagnosis;
	};
	network: LocalResourceProbe;
	volumes: {
		objectStore: LocalResourceProbe;
		postgres: LocalResourceProbe;
		temporal: LocalResourceProbe;
	};
	buckets: {
		docs: LocalResourceProbe;
		source: LocalResourceProbe;
	};
	expectedHashes: {
		objectStore: string | undefined;
		postgres: string | undefined;
		temporalPostgres: string | undefined;
		temporal: string | undefined;
	};
}

export function resolveSharedInfrastructureAction(input: {
	isMainWorktree: boolean;
	status: SharedInfrastructureStatus;
}): SharedInfrastructureAction {
	if (input.status === "ready") {
		return "reuse";
	}
	if (input.status === "unknown") {
		return "reject";
	}
	return input.isMainWorktree ? "reconcile" : "reject";
}

export function sharedComposeUpCommand(): string[] {
	return [
		"compose",
		"--project-name",
		COMPOSE_PROJECT,
		"-f",
		"infra/local/docker-compose.dev.yml",
		"up",
		"-d",
		"--wait",
	];
}

export function classifySharedInfrastructureStatus(input: {
	containers: SharedInfrastructureDiagnosis["containers"];
	network: LocalResourceProbe;
	volumes: SharedInfrastructureDiagnosis["volumes"];
	buckets: SharedInfrastructureDiagnosis["buckets"];
	expectedHashes: SharedInfrastructureDiagnosis["expectedHashes"];
}): SharedInfrastructureStatus {
	const { buckets, containers, expectedHashes, network, volumes } = input;
	if (
		Object.values(containers).some((container) => container.probe === "unknown") ||
		Object.values(expectedHashes).some((hash) => hash === undefined)
	) {
		return "unknown";
	}
	if (Object.values(containers).some((container) => container.probe === "missing")) {
		return "missing";
	}
	if (!Object.values(containers).every((container) => container.running && container.healthy)) {
		return "unhealthy";
	}
	if (network === "unknown" || Object.values(volumes).some((volume) => volume === "unknown")) {
		return "unknown";
	}
	if (network === "missing" || Object.values(volumes).some((volume) => volume === "missing")) {
		return "missing";
	}
	if (buckets.docs === "unknown" || buckets.source === "unknown") {
		return "unknown";
	}
	if (buckets.docs === "missing" || buckets.source === "missing") {
		return "missing";
	}
	if (
		Object.entries(SHARED_CONTAINERS).some(([name, expected]) => {
			const container = containers[name as keyof typeof containers];
			const expectedHash = expectedHashes[name as keyof typeof expectedHashes];
			return (
				container.configHash !== expectedHash ||
				container.project !== COMPOSE_PROJECT ||
				container.service !== expected.service
			);
		})
	) {
		return "drifted";
	}
	return "ready";
}

export function derivedBucketPublicReadPolicy(bucketName: string): string {
	if (!/^[a-z0-9][a-z0-9.-]*$/u.test(bucketName)) {
		throw new Error(`Invalid derived bucket name: ${bucketName}`);
	}
	return JSON.stringify({
		Statement: [
			{
				Action: ["s3:GetObject"],
				Effect: "Allow",
				Principal: { AWS: ["*"] },
				Resource: [`arn:aws:s3:::${bucketName}/dining/floorplans/*`],
			},
		],
		Version: "2012-10-17",
	});
}

export async function inspectSharedCapabilities(input: {
	derivedBucketName?: string;
	required: readonly LocalDevCapability[];
}): Promise<SharedCapabilityDiagnosis> {
	const required = [...new Set(input.required)];
	const diagnosis: SharedCapabilityDiagnosis = { required };
	const needsObjectStore = required.some((capability) =>
		["derived-bucket", "source-bucket", "docs-bucket", "docs-source"].includes(capability),
	);
	if (required.includes("postgres")) {
		diagnosis.postgres = await probePostgres();
	}
	if (needsObjectStore) {
		diagnosis.objectStore = await probeObjectStore();
	}
	if (required.includes("temporal")) {
		diagnosis.temporal = await probeTemporal();
	}
	if (required.includes("source-bucket")) {
		diagnosis.sourceBucket =
			diagnosis.objectStore === "present"
				? await probeLocalBucket(SOURCE_BUCKET)
				: diagnosis.objectStore;
	}
	if (required.includes("docs-bucket")) {
		diagnosis.docsBucket =
			diagnosis.objectStore === "present"
				? await probeLocalBucket(DOCS_BUCKET)
				: diagnosis.objectStore;
	}
	if (required.includes("docs-source")) {
		diagnosis.docsSource =
			diagnosis.docsBucket === "present"
				? await probeLocalObject(DOCS_BUCKET, DOCS_SOURCE_KEY)
				: diagnosis.docsBucket;
	}
	if (required.includes("derived-bucket")) {
		if (input.derivedBucketName) {
			diagnosis.derivedBucket =
				diagnosis.objectStore === "present"
					? await probeLocalBucket(input.derivedBucketName)
					: diagnosis.objectStore;
		} else {
			diagnosis.derivedBucket = "unknown";
		}
	}
	return diagnosis;
}

export function assertRequiredCapabilitiesReady(diagnosis: SharedCapabilityDiagnosis): void {
	for (const capability of diagnosis.required) {
		const state = diagnosis[capabilityToField(capability)];
		if (state !== "present") {
			throw new Error(
				`Shared capability ${capability} is ${state ?? "unknown"}; run pnpm dev:shared-reconcile from the canonical checkout.`,
			);
		}
	}
}

export async function reconcileSharedInfrastructure(repoRoot: string): Promise<void> {
	if (!isMainWorktree(repoRoot)) {
		throw new Error("Shared infrastructure reconcile must run from the canonical checkout.");
	}
	const lockPath = resolve(dirname(resolveLocalDevRegistryPath(repoRoot)), SHARED_LOCK_FILENAME);
	await withLifecycleLock(lockPath, "shared-reconcile", async () => {
		await assertSharedHostPortsAvailable(repoRoot);
		for (const volume of [POSTGRES_VOLUME, OBJECT_STORE_VOLUME, TEMPORAL_VOLUME]) {
			if (!commandSucceeds("docker", ["volume", "inspect", volume])) {
				runCommand("docker", ["volume", "create", volume]);
			}
		}
		if (!commandSucceeds("docker", ["network", "inspect", DATA_NETWORK])) {
			runCommand("docker", ["network", "create", DATA_NETWORK]);
		}
		runCommand("docker", sharedComposeUpCommand(), {
			cwd: repoRoot,
			timeout: SHARED_RECONCILE_TIMEOUT_MS,
		});
		runObjectStore(SOURCE_BUCKET, "create");
		runObjectStore(DOCS_BUCKET, "create");
		ensureSharedDatabaseRoles();
		const after = await inspectSharedInfrastructure(repoRoot);
		if (after.status !== "ready") {
			throw new Error(`Shared local infrastructure did not become ready (status=${after.status}).`);
		}
	});
}

export async function inspectSharedInfrastructure(
	repoRoot: string,
): Promise<SharedInfrastructureDiagnosis> {
	const expectedHashes = {
		objectStore: composeServiceHash(repoRoot, SHARED_CONTAINERS.objectStore.service),
		postgres: composeServiceHash(repoRoot, SHARED_CONTAINERS.postgres.service),
		temporalPostgres: composeServiceHash(repoRoot, SHARED_CONTAINERS.temporalPostgres.service),
		temporal: composeServiceHash(repoRoot, SHARED_CONTAINERS.temporal.service),
	};
	const containers = {
		objectStore: inspectSharedContainer(SHARED_CONTAINERS.objectStore.container),
		postgres: inspectSharedContainer(SHARED_CONTAINERS.postgres.container),
		temporalPostgres: inspectSharedContainer(SHARED_CONTAINERS.temporalPostgres.container),
		temporal: inspectSharedContainer(SHARED_CONTAINERS.temporal.container),
	};
	const network = inspectDockerResource("network", DATA_NETWORK);
	const volumes = {
		objectStore: inspectDockerResource("volume", OBJECT_STORE_VOLUME),
		postgres: inspectDockerResource("volume", POSTGRES_VOLUME),
		temporal: inspectDockerResource("volume", TEMPORAL_VOLUME),
	};
	const dataContainersReady = [containers.objectStore, containers.postgres].every(
		(container) => container.probe === "present" && container.running && container.healthy,
	);
	const buckets = dataContainersReady
		? {
				docs: await probeLocalBucket(DOCS_BUCKET),
				source: await probeLocalBucket(SOURCE_BUCKET),
			}
		: { docs: "unknown" as const, source: "unknown" as const };
	const status = classifySharedInfrastructureStatus({
		buckets,
		containers,
		expectedHashes,
		network,
		volumes,
	});
	const capabilities: SharedCapabilityDiagnosis = {
		derivedBucket: "unknown",
		docsBucket: buckets.docs,
		docsSource:
			buckets.docs === "present"
				? await probeLocalObject(DOCS_BUCKET, DOCS_SOURCE_KEY)
				: buckets.docs,
		objectStore: dataContainersReady ? "present" : "unknown",
		postgres:
			containers.postgres.probe === "present" && containers.postgres.healthy
				? "present"
				: "unknown",
		required: [],
		sourceBucket: buckets.source,
		temporal:
			containers.temporal.probe === "present" && containers.temporal.healthy
				? "present"
				: "unknown",
	};
	return { buckets, capabilities, containers, expectedHashes, network, status, volumes };
}

export async function assertSharedDataInfrastructureReady(repoRoot: string): Promise<void> {
	const diagnosis = await inspectSharedInfrastructure(repoRoot);
	if (!isSharedDataInfrastructureReady(diagnosis)) {
		throw new Error(
			`Shared local data infrastructure is unavailable (status=${diagnosis.status}); run pnpm dev:shared-reconcile from the canonical checkout.`,
		);
	}
}

export function isSharedDataInfrastructureReady(diagnosis: SharedInfrastructureDiagnosis): boolean {
	return (
		diagnosis.capabilities.objectStore === "present" &&
		diagnosis.capabilities.postgres === "present" &&
		diagnosis.capabilities.docsBucket === "present" &&
		diagnosis.capabilities.sourceBucket === "present"
	);
}

export async function localBucketProbe(bucketName: string): Promise<LocalResourceProbe> {
	return await probeLocalBucket(bucketName);
}

export async function localObjectProbe(
	bucketName: string,
	objectKey: string,
): Promise<LocalResourceProbe> {
	return await probeLocalObject(bucketName, objectKey);
}

export function runObjectStore(
	bucketName: string,
	action: "configure" | "create" | "remove",
): void {
	runCommand("docker", objectStoreCommand(bucketName, action));
}

export function objectStoreCommand(
	bucketName: string,
	action: "configure" | "create" | "inspect" | "remove",
): string[] {
	const actionScript = {
		configure:
			'printf "%s\\n" "$PUBLIC_POLICY" > /tmp/derived-public-policy.json && rc anonymous set-json /tmp/derived-public-policy.json "local/$BUCKET"',
		create: 'rc mb --ignore-existing "local/$BUCKET"',
		inspect: 'rc ls "local/$BUCKET" >/dev/null',
		remove: 'rc rb --force "local/$BUCKET"',
	}[action];
	return [
		"run",
		"--rm",
		"--network",
		DATA_NETWORK,
		"--env",
		`BUCKET=${bucketName}`,
		"--env",
		"RC_CONFIG_DIR=/tmp/.rc",
		...(action === "configure"
			? ["--env", `PUBLIC_POLICY=${derivedBucketPublicReadPolicy(bucketName)}`]
			: []),
		"--entrypoint",
		"/bin/sh",
		OBJECT_STORE_CLI_IMAGE,
		"-ec",
		`rc alias set local http://object-store:9000 minioadmin minioadmin >/dev/null; ${actionScript}`,
	];
}

async function probePostgres(): Promise<LocalResourceProbe> {
	const port = await probeLocalPort(5432);
	if (port === "available") {
		return "missing";
	}
	if (port === "unknown") {
		return "unknown";
	}
	const result = captureCommandResult(
		"pg_isready",
		["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "postgres"],
		{ timeout: SHARED_HEALTH_TIMEOUT_MS },
	);
	return result.status === 0 && !result.error && !result.timedOut ? "present" : "unknown";
}

async function probeObjectStore(): Promise<LocalResourceProbe> {
	try {
		const response = await fetch("http://127.0.0.1:9000/health/ready", {
			signal: AbortSignal.timeout(SHARED_HEALTH_TIMEOUT_MS),
		});
		return response.ok ? "present" : response.status === 404 ? "missing" : "unknown";
	} catch (error) {
		const code =
			error instanceof Error && "cause" in error
				? (error.cause as { code?: string })?.code
				: undefined;
		return code === "ECONNREFUSED" ? "missing" : "unknown";
	}
}

async function probeTemporal(): Promise<LocalResourceProbe> {
	const port: LocalPortProbe = await probeLocalPort(7233);
	return port === "occupied" ? "present" : port === "available" ? "missing" : "unknown";
}

function capabilityToField(
	capability: LocalDevCapability,
): keyof Omit<SharedCapabilityDiagnosis, "required"> {
	return capability === "derived-bucket"
		? "derivedBucket"
		: capability === "source-bucket"
			? "sourceBucket"
			: capability === "docs-bucket"
				? "docsBucket"
				: capability === "docs-source"
					? "docsSource"
					: capability;
}

function assertSharedHostPortsAvailable(repoRoot: string): Promise<void> {
	return inspectSharedInfrastructure(repoRoot).then(async (diagnosis) => {
		const expected = [
			[5432, diagnosis.containers.postgres],
			[9000, diagnosis.containers.objectStore],
			[9001, diagnosis.containers.objectStore],
			[7233, diagnosis.containers.temporal],
		] as const;
		for (const [port, container] of expected) {
			const state = await probeLocalPort(port);
			if (state === "unknown") {
				throw new Error(`Unable to inspect shared port ${port}.`);
			}
			if (state === "occupied" && container.probe !== "present") {
				throw new Error(`Shared port ${port} is occupied by an unexpected process.`);
			}
		}
	});
}

function composeServiceHash(repoRoot: string, service: string): string | undefined {
	const result = captureCommandResult(
		"docker",
		[
			"compose",
			"--project-name",
			COMPOSE_PROJECT,
			"-f",
			"infra/local/docker-compose.dev.yml",
			"config",
			`--hash=${service}`,
		],
		{ cwd: repoRoot, timeout: SHARED_HEALTH_TIMEOUT_MS },
	);
	if (result.status !== 0 || result.error || result.timedOut) {
		return;
	}
	const [reportedService, hash] = result.stdout.trim().split(/\s+/u);
	return reportedService === service && hash ? hash : undefined;
}

function inspectSharedContainer(container: string): SharedContainerDiagnosis {
	const result = captureCommandResult("docker", ["inspect", "--format", "{{json .}}", container], {
		timeout: SHARED_HEALTH_TIMEOUT_MS,
	});
	if (result.status !== 0 || result.error || result.timedOut) {
		if (/No such object|No such container/u.test(result.stderr)) {
			return { healthy: false, probe: "missing", running: false };
		}
		return { healthy: false, probe: "unknown", running: false };
	}
	try {
		const value = JSON.parse(result.stdout) as {
			Config?: { Labels?: Record<string, string> };
			State?: { Health?: { Status?: string }; Status?: string };
		};
		const labels = value.Config?.Labels ?? {};
		return {
			configHash: labels["com.docker.compose.config-hash"],
			healthy: value.State?.Health?.Status === "healthy",
			probe: "present",
			project: labels["com.docker.compose.project"],
			running: value.State?.Status === "running",
			service: labels["com.docker.compose.service"],
		};
	} catch {
		return { healthy: false, probe: "unknown", running: false };
	}
}

function inspectDockerResource(kind: "network" | "volume", name: string): LocalResourceProbe {
	const result = captureCommandResult("docker", [kind, "inspect", name], {
		timeout: SHARED_HEALTH_TIMEOUT_MS,
	});
	if (result.status === 0 && !result.error && !result.timedOut) {
		return "present";
	}
	if (/No such object|No such volume|No such network/u.test(result.stderr)) {
		return "missing";
	}
	return "unknown";
}
