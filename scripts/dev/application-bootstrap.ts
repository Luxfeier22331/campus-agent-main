import type { SpawnSyncOptions } from "node:child_process";
import type { LocalDevEnvironmentTarget } from "./environment";
import { localDatabaseUrls } from "./environment";
import { runCommand } from "./process";
import type { LocalDevProfileV1 } from "./profile";

export type LocalApplicationBootstrapStep =
	| "campus-web-docs"
	| "campus-agent-schema"
	| "app-api-seed-local-campus-groups"
	| "app-api-seed-local-test-user"
	| "notice-publisher-seed-local"
	| "ops-web-dining-bootstrap";

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
		{
			args: ["--dir", "jobs/campus-agent-schema", "migrate"],
			command: pnpm,
			options: {
				cwd: repoRoot,
				env: {
					...process.env,
					...postgresEnvironment(database.owner),
					PGSSLMODE: "disable",
				},
			},
			step: "campus-agent-schema",
		},
		appApiCommand("app-api-seed-local-campus-groups", "./ops/db/seed-local-campus-groups.ts"),
		appApiCommand("app-api-seed-local-test-user", "./ops/db/seed-local-test-user.ts"),
		{
			args: ["--dir", "jobs/notice-publisher", "seed-local"],
			command: pnpm,
			options: {
				cwd: repoRoot,
				env: {
					...process.env,
					DEPLOYMENT_ENVIRONMENT: "local",
					NOTICES_DATABASE_SSLMODE: "disable",
					NOTICES_DATABASE_URL: database.noticePublisher,
				},
			},
			step: "notice-publisher-seed-local",
		},
		{
			args: ["--dir", "apps/ops-web", "db:bootstrap-dining"],
			command: pnpm,
			options: { cwd: repoRoot, env: opsWebEnv },
			step: "ops-web-dining-bootstrap",
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
			"campus-agent-schema",
			"app-api-seed-local-campus-groups",
			"app-api-seed-local-test-user",
		],
		"ops-web": ["campus-agent-schema", "notice-publisher-seed-local", "ops-web-dining-bootstrap"],
		"notice-publisher": ["campus-agent-schema", "notice-publisher-seed-local"],
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

function postgresEnvironment(connectionString: string): NodeJS.ProcessEnv {
	const url = new URL(connectionString);
	return {
		PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
		PGHOST: url.hostname,
		PGPASSWORD: decodeURIComponent(url.password),
		PGPORT: url.port || "5432",
		PGUSER: decodeURIComponent(url.username),
	};
}
