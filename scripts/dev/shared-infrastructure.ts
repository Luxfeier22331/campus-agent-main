import { captureCommandResult, commandSucceeds, runCommand } from "./process";
import { isMainWorktree } from "./profile";

const COMPOSE_PROJECT = "campus-agent-local";
const DATA_NETWORK = "campus-agent-data-plane";
const POSTGRES_VOLUME = "local_postgres-data";
const OBJECT_STORE_VOLUME = "local_object-store-data";
const TEMPORAL_VOLUME = "local_temporal-shared-postgres-data";
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

export interface SharedContainerDiagnosis {
	probe: LocalResourceProbe;
	running: boolean;
	healthy: boolean;
	project?: string;
	service?: string;
	configHash?: string;
}

export interface SharedInfrastructureDiagnosis {
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
	if (!input.isMainWorktree || input.status === "unknown") {
		return "reject";
	}
	return "reconcile";
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
	// Compose records the bootstrap path in working_dir/config_files; project, service and hash are the stable identity.
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

export function ensureSharedInfrastructure(repoRoot: string): void {
	const current = inspectSharedInfrastructure(repoRoot);
	const action = resolveSharedInfrastructureAction({
		isMainWorktree: isMainWorktree(repoRoot),
		status: current.status,
	});
	if (action === "reuse") {
		return;
	}
	if (action === "reject") {
		throw new Error(
			`Shared local infrastructure is ${current.status}; run pnpm dev:init from the main checkout before initializing this worktree.`,
		);
	}
	for (const volume of [POSTGRES_VOLUME, OBJECT_STORE_VOLUME, TEMPORAL_VOLUME]) {
		if (!commandSucceeds("docker", ["volume", "inspect", volume])) {
			runCommand("docker", ["volume", "create", volume]);
		}
	}
	if (!commandSucceeds("docker", ["network", "inspect", DATA_NETWORK])) {
		runCommand("docker", ["network", "create", DATA_NETWORK]);
	}
	runCommand("docker", sharedComposeUpCommand(), { cwd: repoRoot });
	runObjectStore(SOURCE_BUCKET, "create");
	runObjectStore(DOCS_BUCKET, "create");
	const after = inspectSharedInfrastructure(repoRoot);
	if (after.status !== "ready") {
		throw new Error(`Shared local infrastructure did not become ready (status=${after.status}).`);
	}
}

export function assertSharedDataInfrastructureReady(repoRoot: string): void {
	const diagnosis = inspectSharedInfrastructure(repoRoot);
	if (!isSharedDataInfrastructureReady(diagnosis)) {
		throw new Error(
			`Shared local data infrastructure is unavailable (status=${diagnosis.status}); run pnpm dev:init from the main checkout before destroying an instance.`,
		);
	}
}

export function isSharedDataInfrastructureReady(diagnosis: SharedInfrastructureDiagnosis): boolean {
	return (
		diagnosis.containers.objectStore.probe === "present" &&
		diagnosis.containers.objectStore.running &&
		diagnosis.containers.objectStore.healthy &&
		diagnosis.containers.postgres.probe === "present" &&
		diagnosis.containers.postgres.running &&
		diagnosis.containers.postgres.healthy &&
		diagnosis.network === "present" &&
		diagnosis.volumes.objectStore === "present" &&
		diagnosis.volumes.postgres === "present" &&
		diagnosis.buckets.docs === "present" &&
		diagnosis.buckets.source === "present"
	);
}

export function inspectSharedInfrastructure(repoRoot: string): SharedInfrastructureDiagnosis {
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
		? { docs: localBucketProbe(DOCS_BUCKET), source: localBucketProbe(SOURCE_BUCKET) }
		: { docs: "unknown" as const, source: "unknown" as const };
	const status = classifySharedInfrastructureStatus({
		buckets,
		containers,
		expectedHashes,
		network,
		volumes,
	});
	return { buckets, containers, expectedHashes, network, status, volumes };
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
		{ cwd: repoRoot },
	);
	if (result.status !== 0 || result.error) {
		return;
	}
	const [reportedService, hash] = result.stdout.trim().split(/\s+/u);
	return reportedService === service && hash ? hash : undefined;
}

function inspectSharedContainer(container: string): SharedContainerDiagnosis {
	const result = captureCommandResult("docker", ["inspect", "--format", "{{json .}}", container]);
	if (result.status !== 0 || result.error) {
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
	const result = captureCommandResult("docker", [kind, "inspect", name]);
	if (result.status === 0 && !result.error) {
		return "present";
	}
	if (/No such object|No such volume|No such network/u.test(result.stderr)) {
		return "missing";
	}
	return "unknown";
}

export function localBucketProbe(bucketName: string): LocalResourceProbe {
	const result = captureCommandResult("docker", objectStoreCommand(bucketName, "inspect"));
	if (result.status === 0 && !result.error) {
		return "present";
	}
	if (/Bucket not found|NoSuchBucket|bucket does not exist/u.test(result.stderr)) {
		return "missing";
	}
	return "unknown";
}

export function localObjectProbe(bucketName: string, objectKey: string): LocalResourceProbe {
	const result = captureCommandResult("docker", [
		"run",
		"--rm",
		"--network",
		DATA_NETWORK,
		"--env",
		`BUCKET=${bucketName}`,
		"--env",
		`OBJECT_KEY=${objectKey}`,
		"--env",
		"RC_CONFIG_DIR=/tmp/.rc",
		"--entrypoint",
		"/bin/sh",
		OBJECT_STORE_CLI_IMAGE,
		"-ec",
		'rc alias set local http://object-store:9000 minioadmin minioadmin >/dev/null; rc stat "local/$BUCKET/$OBJECT_KEY" >/dev/null',
	]);
	if (result.status === 0 && !result.error) {
		return "present";
	}
	if (/Not found: local\/|No such key|Object does not exist/u.test(result.stderr)) {
		return "missing";
	}
	return "unknown";
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
