import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	assertLocalEnvironmentFilesAreManaged,
	LOCAL_DEV_DATABASE_PASSWORDS,
	localDatabaseUrls,
	removeLocalEnvironmentFiles,
	renderLocalEnvironmentFiles,
} from "./environment";
import { captureCommandResult, commandSucceeds, runCommand } from "./process";
import {
	ensureLocalDevProfile,
	isMainWorktree,
	type LocalDevProfileV1,
	listLocalDevProfiles,
	loadLocalDevProfile,
	releaseLocalDevProfile,
	resolveLocalDevProfilePath,
} from "./profile";

const COMPOSE_PROJECT = "campus-agent-local";
const DATA_NETWORK = "campus-agent-data-plane";
const POSTGRES_VOLUME = "local_postgres-data";
const OBJECT_STORE_VOLUME = "local_object-store-data";
const SOURCE_BUCKET = "campus-agent-source";
const DOCS_BUCKET = "campus-agent-derived";
const DOCS_SOURCE_KEY = "campus-docs/source.json";
const POSTGRES_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable";
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
	};
	network: LocalResourceProbe;
	volumes: {
		objectStore: LocalResourceProbe;
		postgres: LocalResourceProbe;
	};
	buckets: {
		docs: LocalResourceProbe;
		source: LocalResourceProbe;
	};
	expectedHashes: {
		objectStore: string | undefined;
		postgres: string | undefined;
	};
}

export type LocalDevInstanceStatus = "ready" | "stale" | "partial" | "unprovisioned" | "unknown";

export interface LocalDevInstanceDiagnosis {
	profile: LocalDevProfileV1;
	worktree: LocalResourceProbe;
	database: LocalResourceProbe;
	bucket: LocalResourceProbe;
	status: LocalDevInstanceStatus;
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
		containers.objectStore.probe === "unknown" ||
		containers.postgres.probe === "unknown" ||
		Object.values(expectedHashes).some((hash) => hash === undefined)
	) {
		return "unknown";
	}
	if (containers.objectStore.probe === "missing" || containers.postgres.probe === "missing") {
		return "missing";
	}
	if (
		!(
			containers.objectStore.running &&
			containers.postgres.running &&
			containers.objectStore.healthy &&
			containers.postgres.healthy
		)
	) {
		return "unhealthy";
	}
	if (
		network === "unknown" ||
		volumes.objectStore === "unknown" ||
		volumes.postgres === "unknown"
	) {
		return "unknown";
	}
	if (
		network === "missing" ||
		volumes.objectStore === "missing" ||
		volumes.postgres === "missing"
	) {
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
		containers.objectStore.configHash !== expectedHashes.objectStore ||
		containers.postgres.configHash !== expectedHashes.postgres ||
		containers.objectStore.project !== COMPOSE_PROJECT ||
		containers.postgres.project !== COMPOSE_PROJECT ||
		containers.objectStore.service !== SHARED_CONTAINERS.objectStore.service ||
		containers.postgres.service !== SHARED_CONTAINERS.postgres.service
	) {
		return "drifted";
	}
	return "ready";
}

export type IsolatedResourceState = "absent" | "complete" | "partial";

export function classifyIsolatedResourceState(input: {
	bucketExists: boolean;
	databaseExists: boolean;
}): IsolatedResourceState {
	if (input.bucketExists && input.databaseExists) {
		return "complete";
	}
	if (!(input.bucketExists || input.databaseExists)) {
		return "absent";
	}
	return "partial";
}

export type IsolatedResourceAction = "create" | "ready" | "repair-bucket";

export function resolveIsolatedResourceAction(input: {
	bucketExists: boolean;
	databaseExists: boolean;
}): IsolatedResourceAction {
	if (input.bucketExists && !input.databaseExists) {
		throw new Error("The local bucket exists but its database is missing.");
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

export function initializeLocalDevelopment(repoRoot: string): LocalDevProfileV1 {
	assertLocalEnvironmentFilesAreManaged(repoRoot);
	ensureSharedInfrastructure(repoRoot);
	const profile = ensureLocalDevProfile(repoRoot);
	ensureDatabaseRoles();

	const databaseProbe = localDatabaseProbe(profile.databaseName);
	const bucketProbe = localBucketProbe(profile.bucketName);
	if (databaseProbe === "unknown" || bucketProbe === "unknown") {
		throw new Error(
			`Unable to inspect local instance ${profile.instanceId} (database=${databaseProbe}, bucket=${bucketProbe}). Check shared infrastructure and retry.`,
		);
	}
	const databaseExists = databaseProbe === "present";
	const bucketExists = bucketProbe === "present";
	let action: IsolatedResourceAction;
	try {
		action = resolveIsolatedResourceAction({ bucketExists, databaseExists });
	} catch {
		throw new Error(
			`Local instance ${profile.instanceId} is partially provisioned (database=${databaseExists}, bucket=${bucketExists}). Destroy it explicitly before recreating it.`,
		);
	}
	if (action === "create") {
		createIsolatedResources(profile);
	} else if (action === "repair-bucket") {
		runObjectStore(profile.bucketName, "create");
		runObjectStore(profile.bucketName, "configure");
	} else {
		runObjectStore(profile.bucketName, "configure");
	}

	renderLocalEnvironmentFiles({ profile, repoRoot });
	seedCampusWebDocs(repoRoot);
	installApplicationSchemas(repoRoot, profile);
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
	const managedEnvironmentReady = [
		"apps/app-api/.env.local",
		"apps/app-api/.dev.vars.local",
		"apps/campus-web/.dev.vars.local",
		"apps/ops-web/.env.local",
		"apps/source-collector/adapters/internal-portal/.env.local",
	].every((path) => {
		const absolutePath = resolve(repoRoot, path);
		return (
			existsSync(absolutePath) &&
			readFileSync(absolutePath, "utf8").startsWith("# Managed by pnpm dev:init.")
		);
	});
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
	assertSharedInfrastructureReady(input.repoRoot);
	const databaseProbe = localDatabaseProbe(profile.databaseName);
	const bucketProbe = localBucketProbe(profile.bucketName);
	if (databaseProbe === "unknown" || bucketProbe === "unknown") {
		throw new Error(
			`Unable to inspect instance resources (database=${databaseProbe}, bucket=${bucketProbe}); no data was changed.`,
		);
	}
	if (databaseProbe === "present") {
		runPsql(`DROP DATABASE ${quoteIdentifier(profile.databaseName)} WITH (FORCE);`);
	}
	if (bucketProbe === "present") {
		runObjectStore(profile.bucketName, "remove");
	}
	if (existsSync(profile.worktreePath)) {
		removeLocalEnvironmentFiles(profile.worktreePath);
	}
	releaseLocalDevProfile(input.repoRoot, input.instanceId);
	console.log(`Destroyed local development instance ${input.instanceId}.`);
}

export function formatProfileSummary(profile: LocalDevProfileV1): string {
	return [
		`Local instance: ${profile.instanceId}`,
		`Campus Web: http://127.0.0.1:${profile.ports.campusWeb}`,
		`app-api: http://127.0.0.1:${profile.ports.appApi}`,
		`Ops Web: http://127.0.0.1:${profile.ports.opsWeb}/dining`,
		`Database: ${profile.databaseName}`,
		`Source bucket: ${SOURCE_BUCKET}`,
		`Campus docs bucket: ${DOCS_BUCKET}`,
		`Derived bucket: ${profile.bucketName}`,
	].join("\n");
}

export function diagnoseLocalDevInstances(repoRoot: string): LocalDevInstanceDiagnosis[] {
	const sharedInfrastructure = inspectSharedInfrastructure(repoRoot);
	const sharedReady = sharedInfrastructure.status === "ready";
	return listLocalDevProfiles(repoRoot).map((profile) => {
		const worktree: LocalResourceProbe = existsSync(profile.worktreePath) ? "present" : "missing";
		const database = sharedReady ? localDatabaseProbe(profile.databaseName) : "unknown";
		const bucket = sharedReady ? localBucketProbe(profile.bucketName) : "unknown";
		return {
			bucket,
			database,
			profile,
			status: classifyLocalDevInstanceStatus({ bucket, database, worktree }),
			worktree,
		};
	});
}

export function classifyLocalDevInstanceStatus(input: {
	bucket: LocalResourceProbe;
	database: LocalResourceProbe;
	worktree: LocalResourceProbe;
}): LocalDevInstanceStatus {
	if ([input.bucket, input.database, input.worktree].includes("unknown")) {
		return "unknown";
	}
	const complete = input.bucket === "present" && input.database === "present";
	const missing = input.bucket === "missing" && input.database === "missing";
	if (input.worktree === "missing") {
		return "stale";
	}
	if (complete) {
		return "ready";
	}
	if (missing) {
		return "unprovisioned";
	}
	return "partial";
}

function ensureSharedInfrastructure(repoRoot: string): void {
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
	for (const volume of [POSTGRES_VOLUME, OBJECT_STORE_VOLUME]) {
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

function assertSharedInfrastructureReady(repoRoot: string): void {
	const diagnosis = inspectSharedInfrastructure(repoRoot);
	if (diagnosis.status !== "ready") {
		throw new Error(
			`Shared local infrastructure is ${diagnosis.status}; run pnpm dev:init from the main checkout before destroying an instance.`,
		);
	}
}

function inspectSharedInfrastructure(repoRoot: string): SharedInfrastructureDiagnosis {
	const expectedHashes = {
		objectStore: composeServiceHash(repoRoot, SHARED_CONTAINERS.objectStore.service),
		postgres: composeServiceHash(repoRoot, SHARED_CONTAINERS.postgres.service),
	};
	const containers = {
		objectStore: inspectSharedContainer(SHARED_CONTAINERS.objectStore.container),
		postgres: inspectSharedContainer(SHARED_CONTAINERS.postgres.container),
	};
	const network = inspectDockerResource("network", DATA_NETWORK);
	const volumes = {
		objectStore: inspectDockerResource("volume", OBJECT_STORE_VOLUME),
		postgres: inspectDockerResource("volume", POSTGRES_VOLUME),
	};
	const containersReady =
		containers.objectStore.probe === "present" &&
		containers.postgres.probe === "present" &&
		containers.objectStore.running &&
		containers.postgres.running &&
		containers.objectStore.healthy &&
		containers.postgres.healthy;
	const buckets = containersReady
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

function seedCampusWebDocs(repoRoot: string): void {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	runCommand(pnpm, ["--dir", "apps/campus-web", "docs:seed-local"], {
		cwd: repoRoot,
		env: {
			...process.env,
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		},
	});
}

function ensureDatabaseRoles(): void {
	const roles = [
		["campus_agent", LOCAL_DEV_DATABASE_PASSWORDS.owner, true],
		["app_api", LOCAL_DEV_DATABASE_PASSWORDS.appApi, true],
		["execution_control", "", false],
		["ops_web", LOCAL_DEV_DATABASE_PASSWORDS.opsWeb, true],
	] as const;
	for (const [name, password, login] of roles) {
		const passwordSql = login ? ` PASSWORD ${quoteLiteral(password)}` : "";
		runPsql(
			`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(name)}) THEN CREATE ROLE ${quoteIdentifier(name)} ${login ? "LOGIN" : "NOLOGIN"}${passwordSql}; ELSE ALTER ROLE ${quoteIdentifier(name)} ${login ? "LOGIN" : "NOLOGIN"}${passwordSql}; END IF; END $role$;`,
		);
	}
}

function createIsolatedResources(profile: LocalDevProfileV1): void {
	try {
		runPsql(
			`CREATE DATABASE ${quoteIdentifier(profile.databaseName)} OWNER ${quoteIdentifier("campus_agent")};`,
		);
		runPsql(
			[
				`REVOKE ALL ON DATABASE ${quoteIdentifier(profile.databaseName)} FROM PUBLIC`,
				...["app_api", "ops_web"].map(
					(role) =>
						`GRANT CONNECT ON DATABASE ${quoteIdentifier(profile.databaseName)} TO ${quoteIdentifier(role)}`,
				),
			].join(";\n"),
		);
		runObjectStore(profile.bucketName, "create");
		runObjectStore(profile.bucketName, "configure");
	} catch (error) {
		if (localBucketProbe(profile.bucketName) === "present") {
			runObjectStore(profile.bucketName, "remove");
		}
		if (localDatabaseProbe(profile.databaseName) === "present") {
			runPsql(`DROP DATABASE ${quoteIdentifier(profile.databaseName)} WITH (FORCE);`);
		}
		throw error;
	}
}

function installApplicationSchemas(repoRoot: string, profile: LocalDevProfileV1): void {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const database = localDatabaseUrls(profile);
	runCommand(
		pnpm,
		[
			"--dir",
			"apps/app-api",
			"exec",
			"tsx",
			"./scripts/run-with-local-env.ts",
			pnpm,
			"exec",
			"tsx",
			"./ops/db/schema.ts",
		],
		{ cwd: repoRoot },
	);
	const opsWebEnv = {
		...process.env,
		DEPLOYMENT_ENVIRONMENT: "local",
		NODE_ENV: "development",
		OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
		OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
		OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
		OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
		OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		OPS_WEB_DATABASE_SSLMODE: "disable",
		OPS_WEB_DATABASE_URL: database.opsWeb,
		OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
		OPS_WEB_SCHEMA_DATABASE_URL: database.owner,
	};
	for (const command of ["db:apply-dining", "db:bootstrap-dining"]) {
		runCommand(pnpm, ["--dir", "apps/ops-web", command], {
			cwd: repoRoot,
			env: opsWebEnv,
		});
	}
}

function localDatabaseProbe(databaseName: string): LocalResourceProbe {
	const result = captureCommandResult("psql", [
		POSTGRES_ADMIN_URL,
		"-At",
		"-v",
		"ON_ERROR_STOP=1",
		"-c",
		`SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(databaseName)};`,
	]);
	if (result.status !== 0 || result.error) {
		return "unknown";
	}
	return result.stdout.trim() === "1" ? "present" : "missing";
}

function localBucketProbe(bucketName: string): LocalResourceProbe {
	const result = captureCommandResult("docker", objectStoreCommand(bucketName, "inspect"));
	if (result.status === 0 && !result.error) {
		return "present";
	}
	if (/Bucket not found|NoSuchBucket|bucket does not exist/u.test(result.stderr)) {
		return "missing";
	}
	return "unknown";
}

function localObjectProbe(bucketName: string, objectKey: string): LocalResourceProbe {
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

function runObjectStore(bucketName: string, action: "configure" | "create" | "remove"): void {
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

function runPsql(sql: string): void {
	runCommand("psql", [POSTGRES_ADMIN_URL, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function quoteIdentifier(value: string): string {
	if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
		throw new Error(`Invalid PostgreSQL identifier: ${value}`);
	}
	return `"${value}"`;
}

function quoteLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

export function localInstanceDestroyPreview(repoRoot: string, instanceId?: string): string {
	const profile = instanceId
		? listLocalDevProfiles(repoRoot).find((item) => item.instanceId === instanceId)
		: existsSync(resolveLocalDevProfilePath(repoRoot))
			? loadLocalDevProfile(repoRoot)
			: undefined;
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
