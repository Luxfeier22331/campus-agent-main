import type { SpawnSyncOptions } from "node:child_process";
import { resolve } from "node:path";
import type { LocalDevEnvironmentTarget } from "./environment";
import {
	localDatabaseUrls,
	resolveLocalLegacyProviderConfigEncryptionKeyPath,
	resolveLocalModelConfigEncryptionKeyPath,
} from "./environment";
import { runCommand } from "./process";
import type { LocalDevProfileV1 } from "./profile";

export type LocalApplicationBootstrapStep =
	| "campus-web-docs"
	| "app-api-schema"
	| "execution-control-schema"
	| "model-config-schema"
	| "app-api-seed-local-test-user"
	| "ops-web-schema"
	| "ops-web-dining-bootstrap"
	| "notice-publisher-migrate";

export interface LocalApplicationBootstrapCommand {
	args: string[];
	command: string;
	options: SpawnSyncOptions;
	step: LocalApplicationBootstrapStep;
}

type LocalApplicationBootstrapTarget = Exclude<
	LocalDevEnvironmentTarget,
	"all" | "internal-portal-collection" | "notice-classifier"
>;

export function localApplicationBootstrapCommands(
	repoRoot: string,
	profile: LocalDevProfileV1,
	target: LocalApplicationBootstrapTarget | "all" = "all",
): LocalApplicationBootstrapCommand[] {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const database = localDatabaseUrls(profile);
	const modelConfigEncryptionKeyPath = resolveLocalModelConfigEncryptionKeyPath(repoRoot);
	const legacyProviderConfigEncryptionKeyPath =
		resolveLocalLegacyProviderConfigEncryptionKeyPath(repoRoot);
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
	const appApiCommand = (step: LocalApplicationBootstrapStep, script: string) => ({
		args: [
			"--dir",
			"apps/app-api",
			"exec",
			"node",
			"--env-file-if-exists=.env",
			"--env-file-if-exists=.env.local",
			"--import=tsx",
			script,
		],
		command: pnpm,
		options: { cwd: repoRoot },
		step,
	});

	const commands = [
		{
			args: ["--dir", "apps/campus-web", "docs:seed-local"],
			command: pnpm,
			options: {
				cwd: repoRoot,
				env: {
					...process.env,
					OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
					OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
					OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
				},
			},
			step: "campus-web-docs",
		},
		appApiCommand("app-api-schema", "./ops/db/schema.ts"),
		{
			args: [
				"run",
				"./cmd/run-projection-schema",
				"--mode",
				"install",
				"--database-url",
				database.owner,
				"--evidence-path",
				resolve(repoRoot, "var/dev/execution-control-schema.json"),
				"--provider-config-encryption-key-path",
				legacyProviderConfigEncryptionKeyPath,
			],
			command: "go",
			options: { cwd: resolve(repoRoot, "apps/execution-control") },
			step: "execution-control-schema",
		},
		{
			args: [
				"run",
				"./cmd/model-config-schema",
				"--database-url",
				database.owner,
				"--encryption-key-path",
				modelConfigEncryptionKeyPath,
				"--legacy-encryption-key-path",
				legacyProviderConfigEncryptionKeyPath,
			],
			command: "go",
			options: { cwd: resolve(repoRoot, "apps/model-config") },
			step: "model-config-schema",
		},
		appApiCommand("app-api-seed-local-test-user", "./ops/db/seed-local-test-user.ts"),
		{
			args: ["--dir", "apps/ops-web", "db:apply"],
			command: pnpm,
			options: { cwd: repoRoot, env: opsWebEnv },
			step: "ops-web-schema",
		},
		{
			args: ["--dir", "apps/ops-web", "db:bootstrap-dining"],
			command: pnpm,
			options: { cwd: repoRoot, env: opsWebEnv },
			step: "ops-web-dining-bootstrap",
		},
		{
			args: ["--dir", "jobs/notice-publisher", "migrate"],
			command: pnpm,
			options: {
				cwd: repoRoot,
				env: { ...process.env, NOTICES_DATABASE_URL: database.owner },
			},
			step: "notice-publisher-migrate",
		},
	];
	if (target === "all") {
		return commands;
	}
	const targetSteps: Record<
		LocalApplicationBootstrapTarget,
		readonly LocalApplicationBootstrapStep[]
	> = {
		core: [
			"campus-web-docs",
			"app-api-schema",
			"execution-control-schema",
			"model-config-schema",
			"app-api-seed-local-test-user",
		],
		"ops-web": ["ops-web-schema", "ops-web-dining-bootstrap"],
		"notice-publisher": ["notice-publisher-migrate"],
	};
	const allowed = new Set(targetSteps[target]);
	return commands.filter(({ step }) => allowed.has(step));
}

export function bootstrapLocalApplications(
	repoRoot: string,
	profile: LocalDevProfileV1,
	target: LocalApplicationBootstrapTarget = "core",
): void {
	for (const { args, command, options } of localApplicationBootstrapCommands(
		repoRoot,
		profile,
		target,
	)) {
		runCommand(command, args, options);
	}
}
