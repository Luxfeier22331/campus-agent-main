import type { SpawnSyncOptions } from "node:child_process";

import { localDatabaseUrls } from "./environment";
import { runCommand } from "./process";
import type { LocalDevProfileV1 } from "./profile";

export type LocalApplicationBootstrapStep =
	| "campus-web-docs"
	| "app-api-schema"
	| "app-api-seed-local-test-user"
	| "ops-web-dining-schema"
	| "ops-web-dining-bootstrap"
	| "ingestion-control-schema"
	| "ingestion-control-migrate"
	| "notice-publisher-migrate";

export interface LocalApplicationBootstrapCommand {
	args: string[];
	command: string;
	options: SpawnSyncOptions;
	step: LocalApplicationBootstrapStep;
}

export function localApplicationBootstrapCommands(
	repoRoot: string,
	profile: LocalDevProfileV1,
): LocalApplicationBootstrapCommand[] {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const database = localDatabaseUrls(profile);
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
	const ingestionControlEnv = {
		...process.env,
		DEPLOYMENT_ENVIRONMENT: "local",
		INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
		INGESTION_CONTROL_DATABASE_URL: database.ingestionControl,
		INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE: "disable",
		INGESTION_CONTROL_SCHEMA_DATABASE_URL: database.owner,
	};
	const appApiCommand = (step: LocalApplicationBootstrapStep, script: string) => ({
		args: [
			"--dir",
			"apps/app-api",
			"exec",
			"tsx",
			"./scripts/run-with-local-env.ts",
			pnpm,
			"exec",
			"tsx",
			script,
		],
		command: pnpm,
		options: { cwd: repoRoot },
		step,
	});

	return [
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
		appApiCommand("app-api-seed-local-test-user", "./ops/db/seed-local-test-user.ts"),
		{
			args: ["--dir", "apps/ops-web", "db:apply-dining"],
			command: pnpm,
			options: { cwd: repoRoot, env: opsWebEnv },
			step: "ops-web-dining-schema",
		},
		{
			args: ["--dir", "apps/ops-web", "db:bootstrap-dining"],
			command: pnpm,
			options: { cwd: repoRoot, env: opsWebEnv },
			step: "ops-web-dining-bootstrap",
		},
		{
			args: ["--dir", "apps/ingestion-control", "schema:bootstrap"],
			command: pnpm,
			options: { cwd: repoRoot, env: ingestionControlEnv },
			step: "ingestion-control-schema",
		},
		{
			args: ["--dir", "apps/ingestion-control", "migrate"],
			command: pnpm,
			options: { cwd: repoRoot, env: ingestionControlEnv },
			step: "ingestion-control-migrate",
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
}

export function bootstrapLocalApplications(repoRoot: string, profile: LocalDevProfileV1): void {
	for (const { args, command, options } of localApplicationBootstrapCommands(repoRoot, profile)) {
		runCommand(command, args, options);
	}
}
