import { existsSync } from "node:fs";

import { LOCAL_DEV_DATABASE_PASSWORDS } from "./environment";
import { captureCommandResult, runCommand } from "./process";
import {
	calculateLocalDevRuntimePorts,
	type LocalDevProfileV1,
	listLocalDevProfiles,
	loadLocalDevProfile,
	resolveLocalDevProfilePath,
} from "./profile";
import {
	DOCS_BUCKET,
	inspectSharedInfrastructure,
	type LocalResourceProbe,
	localBucketProbe,
	runObjectStore,
	SOURCE_BUCKET,
} from "./shared-infrastructure";

const POSTGRES_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable";

export type LocalDevInstanceStatus = "ready" | "stale" | "partial" | "unprovisioned" | "unknown";

export interface LocalDevInstanceDiagnosis {
	profile: LocalDevProfileV1;
	worktree: LocalResourceProbe;
	database: LocalResourceProbe;
	bucket: LocalResourceProbe;
	status: LocalDevInstanceStatus;
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

export function ensureLocalInstanceResources(profile: LocalDevProfileV1): void {
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
	grantDatabaseConnect(profile.databaseName);
}

export function localTemporalNamespace(profile: LocalDevProfileV1): string {
	return `campus-agent-local-${profile.instanceId}`;
}

export function ensureLocalTemporalNamespace(repoRoot: string, profile: LocalDevProfileV1): void {
	const namespace = localTemporalNamespace(profile);
	const composeArgs = [
		"compose",
		"--project-name",
		"campus-agent-local",
		"-f",
		"infra/local/docker-compose.dev.yml",
		"exec",
		"-T",
		"temporal",
		"temporal",
		"operator",
		"namespace",
	];
	const describe = captureCommandResult(
		"docker",
		[...composeArgs, "describe", "--address", "temporal:7233", "--namespace", namespace],
		{ cwd: repoRoot },
	);
	if (describe.status === 0 && !describe.error) {
		return;
	}
	runCommand(
		"docker",
		[
			...composeArgs,
			"create",
			"--address",
			"temporal:7233",
			"--namespace",
			namespace,
			"--retention",
			"24h",
		],
		{ cwd: repoRoot },
	);
}

export function destroyLocalInstanceResources(profile: LocalDevProfileV1): void {
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
}

export function formatProfileSummary(profile: LocalDevProfileV1): string {
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	return [
		`Local instance: ${profile.instanceId}`,
		`Campus Web: http://127.0.0.1:${profile.ports.campusWeb}`,
		`app-api: http://127.0.0.1:${profile.ports.appApi}`,
		`Ops Web: http://127.0.0.1:${profile.ports.opsWeb}/dining`,
		`Execution Control: http://127.0.0.1:${runtimePorts.executionControl}`,
		`Model Config: http://127.0.0.1:${runtimePorts.modelConfig}`,
		`Agent Runtime: http://127.0.0.1:${runtimePorts.agentRuntime}`,
		`Temporal namespace: ${localTemporalNamespace(profile)}`,
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

function ensureDatabaseRoles(): void {
	const roles = [
		["campus_agent", LOCAL_DEV_DATABASE_PASSWORDS.owner, true],
		["app_api", LOCAL_DEV_DATABASE_PASSWORDS.appApi, true],
		["execution_control", LOCAL_DEV_DATABASE_PASSWORDS.executionControl, true],
		["model_config", LOCAL_DEV_DATABASE_PASSWORDS.modelConfig, true],
		["ops_web", LOCAL_DEV_DATABASE_PASSWORDS.opsWeb, true],
		["notice_publisher", LOCAL_DEV_DATABASE_PASSWORDS.noticePublisher, true],
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
				...["app_api", "execution_control", "model_config", "ops_web", "notice_publisher"].map(
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

function grantDatabaseConnect(databaseName: string): void {
	runPsql(
		["execution_control", "model_config", "notice_publisher"]
			.map(
				(role) =>
					`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(role)}`,
			)
			.join(";\n"),
	);
}

export function localDatabaseProbe(databaseName: string): LocalResourceProbe {
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
