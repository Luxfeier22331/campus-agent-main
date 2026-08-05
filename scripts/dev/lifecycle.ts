import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	assertLocalEnvironmentFilesAreManaged,
	LOCAL_DEV_DATABASE_PASSWORDS,
	localDatabaseUrls,
	removeLocalEnvironmentFiles,
	renderLocalEnvironmentFiles,
} from "./environment";
import { captureCommand, commandSucceeds, runCommand } from "./process";
import {
	ensureLocalDevProfile,
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
	const profile = ensureLocalDevProfile(repoRoot);
	assertLocalEnvironmentFilesAreManaged(repoRoot);
	ensureSharedInfrastructure(repoRoot);
	ensureDatabaseRoles();

	const databaseExists = localDatabaseExists(profile.databaseName);
	const bucketExists = localBucketExists(profile.bucketName);
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
	bucketExists: boolean;
	databaseExists: boolean;
	managedEnvironmentReady: boolean;
	profile: LocalDevProfileV1;
	sharedInfrastructureReady: boolean;
	docsBucketExists: boolean;
	docsSourceExists: boolean;
	sourceBucketExists: boolean;
} {
	const profile = loadLocalDevProfile(repoRoot);
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
	return {
		bucketExists: localBucketExists(profile.bucketName),
		databaseExists: localDatabaseExists(profile.databaseName),
		docsBucketExists: localBucketExists(DOCS_BUCKET),
		docsSourceExists: localObjectExists(DOCS_BUCKET, DOCS_SOURCE_KEY),
		managedEnvironmentReady,
		profile,
		sharedInfrastructureReady:
			commandSucceeds("docker", ["inspect", `${COMPOSE_PROJECT}-postgres-1`]) &&
			commandSucceeds("docker", ["inspect", `${COMPOSE_PROJECT}-object-store-1`]),
		sourceBucketExists: localBucketExists(SOURCE_BUCKET),
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
	ensureSharedInfrastructure(input.repoRoot);
	if (localDatabaseExists(profile.databaseName)) {
		runPsql(`DROP DATABASE ${quoteIdentifier(profile.databaseName)} WITH (FORCE);`);
	}
	if (localBucketExists(profile.bucketName)) {
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

function ensureSharedInfrastructure(repoRoot: string): void {
	for (const volume of [POSTGRES_VOLUME, OBJECT_STORE_VOLUME]) {
		if (!commandSucceeds("docker", ["volume", "inspect", volume])) {
			runCommand("docker", ["volume", "create", volume]);
		}
	}
	if (!commandSucceeds("docker", ["network", "inspect", DATA_NETWORK])) {
		runCommand("docker", ["network", "create", DATA_NETWORK]);
	}
	runCommand(
		"docker",
		[
			"compose",
			"--project-name",
			COMPOSE_PROJECT,
			"-f",
			"infra/local/docker-compose.dev.yml",
			"up",
			"-d",
			"--wait",
			"--remove-orphans",
		],
		{ cwd: repoRoot },
	);
	runObjectStore(SOURCE_BUCKET, "create");
	runObjectStore(DOCS_BUCKET, "create");
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
		if (localBucketExists(profile.bucketName)) {
			runObjectStore(profile.bucketName, "remove");
		}
		if (localDatabaseExists(profile.databaseName)) {
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

function localDatabaseExists(databaseName: string): boolean {
	return (
		captureCommand("psql", [
			POSTGRES_ADMIN_URL,
			"-At",
			"-v",
			"ON_ERROR_STOP=1",
			"-c",
			`SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(databaseName)};`,
		]) === "1"
	);
}

function localBucketExists(bucketName: string): boolean {
	return commandSucceeds("docker", objectStoreCommand(bucketName, "inspect"));
}

function localObjectExists(bucketName: string, objectKey: string): boolean {
	return commandSucceeds("docker", [
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
