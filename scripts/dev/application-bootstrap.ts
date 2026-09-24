import type { SpawnSyncOptions } from "node:child_process";

import { NOTICE_CATEGORIES } from "@campus-agent/notices";

import { localDatabaseUrls, localModelConfigCommandEnvironment } from "./environment";
import { captureCommandResult, runCommand } from "./process";
import type { LocalDevProfile } from "./profile";
import type { LocalBootstrapStep, LocalModelConfigName } from "./targets";

export type LocalApplicationBootstrapStep = Exclude<LocalBootstrapStep, "temporal-namespace">;

export interface LocalApplicationBootstrapCommand {
	args: string[];
	command: string;
	options: SpawnSyncOptions;
	step: LocalApplicationBootstrapStep;
}

export type BootstrapProbeState = "ready" | "missing" | "unknown" | "invalid";

export interface BootstrapProbeResult {
	reason?: string;
	state: BootstrapProbeState;
}

export function localApplicationBootstrapCommands(
	repoRoot: string,
	profile: LocalDevProfile,
	steps: readonly LocalApplicationBootstrapStep[] = [
		"campus-agent-schema",
		"app-api-seed-local-test-user",
		"notice-publisher-seed-local",
	],
	modelConfigNames: readonly LocalModelConfigName[] = [],
): LocalApplicationBootstrapCommand[] {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const database = localDatabaseUrls(profile);

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
	const modelConfigCommand = (
		step: LocalApplicationBootstrapStep,
		operation: "check" | "seed",
	): LocalApplicationBootstrapCommand => ({
		args: [
			"--silent",
			"--dir",
			"apps/model-config",
			operation === "seed" ? "local:seed" : "local:check",
			...modelConfigNames.flatMap((name) => ["--name", name]),
		],
		command: pnpm,
		options: {
			cwd: repoRoot,
			env: localModelConfigCommandEnvironment({ names: modelConfigNames, profile, repoRoot }),
		},
		step,
	});
	const commands: LocalApplicationBootstrapCommand[] = [
		{
			args: ["--dir", "jobs/campus-agent-schema", "migrate"],
			command: pnpm,
			options: {
				cwd: repoRoot,
				env: { ...process.env, ...postgresEnvironment(database.owner), PGSSLMODE: "disable" },
			},
			step: "campus-agent-schema",
		},
		modelConfigCommand("model-config-seed", "seed"),
		appApiCommand("app-api-seed-local-test-user", "./ops/db/seed-local-test-user.ts"),
		modelConfigCommand("model-config-check", "check"),
		{
			args: ["--dir", "jobs/notice-publisher", "exec", "tsx", "src/seed-local.ts"],
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
	];
	const byStep = new Map(commands.map((command) => [command.step, command]));
	return steps.flatMap((step) => {
		const command = byStep.get(step);
		return command ? [command] : [];
	});
}

export async function bootstrapLocalApplications(
	repoRoot: string,
	profile: LocalDevProfile,
	steps: readonly LocalApplicationBootstrapStep[],
	modelConfigNames: readonly LocalModelConfigName[] = [],
): Promise<string[]> {
	const executed: string[] = [];
	for (const step of steps) {
		const before = await probeLocalBootstrapStep(repoRoot, profile, step, modelConfigNames);
		if (before.state === "ready") {
			continue;
		}
		if (before.state === "invalid" || before.state === "unknown") {
			throw new Error(`Cannot bootstrap ${step}: ${before.reason ?? before.state}.`);
		}
		const command = localApplicationBootstrapCommands(
			repoRoot,
			profile,
			[step],
			modelConfigNames,
		)[0];
		if (!command) {
			throw new Error(`No bootstrap command registered for ${step}.`);
		}
		runCommand(command.command, command.args, { ...command.options, timeout: 120_000 });
		executed.push(step);
		const after = await probeLocalBootstrapStep(repoRoot, profile, step, modelConfigNames);
		if (after.state !== "ready") {
			throw new Error(`Bootstrap ${step} did not become ready: ${after.reason ?? after.state}.`);
		}
	}
	return executed;
}

export async function probeLocalBootstrapStep(
	repoRoot: string,
	profile: LocalDevProfile,
	step: LocalApplicationBootstrapStep,
	modelConfigNames: readonly LocalModelConfigName[] = [],
): Promise<BootstrapProbeResult> {
	if (step === "model-config-seed" || step === "model-config-check") {
		return await probeLocalModelConfig(repoRoot, profile, modelConfigNames);
	}
	if (step === "campus-agent-schema") {
		return await probeSchema(repoRoot, profile);
	}
	if (step === "app-api-seed-local-test-user") {
		return await probeSql(
			repoRoot,
			localDatabaseUrls(profile).owner,
			`select count(*) from app_auth."user" where email in ('test@muc.edu.cn', 'admin@muc.edu.cn')`,
			{ emptyIsMissing: true, exact: 2 },
		);
	}
	if (step === "notice-publisher-seed-local") {
		return await probeSql(
			repoRoot,
			localDatabaseUrls(profile).owner,
			"select count(*) from notices.categories",
			{ minimum: NOTICE_CATEGORIES.length },
		);
	}
	return { state: "invalid", reason: `Unknown bootstrap step: ${step}` };
}

async function probeLocalModelConfig(
	repoRoot: string,
	profile: LocalDevProfile,
	names: readonly LocalModelConfigName[],
): Promise<BootstrapProbeResult> {
	if (names.length === 0) {
		return { reason: "model config bootstrap names are missing", state: "unknown" };
	}
	const command = localApplicationBootstrapCommands(
		repoRoot,
		profile,
		["model-config-check"],
		names,
	)[0];
	if (!command) {
		return { reason: "model config check command is not registered", state: "unknown" };
	}
	const result = captureCommandResult(command.command, command.args, {
		...command.options,
		stdio: "pipe",
		timeout: 120_000,
	});
	if (result.error || result.timedOut || !result.stdout.trim()) {
		return { reason: "model config check did not return a result", state: "unknown" };
	}
	try {
		const payload = JSON.parse(result.stdout) as {
			checks?: Array<{ state?: BootstrapProbeState }>;
		};
		const states = payload.checks?.map((check) => check.state) ?? [];
		if (states.length !== names.length) {
			return { reason: "model config check returned an incomplete result", state: "unknown" };
		}
		if (states.includes("invalid")) {
			return { state: "invalid" };
		}
		if (states.includes("unknown")) {
			return { state: "unknown" };
		}
		if (states.every((state) => state === "ready")) {
			return { state: "ready" };
		}
		if (states.every((state) => state === "missing" || state === "ready")) {
			return { state: "missing" };
		}
		return { reason: "model config check returned an invalid state", state: "unknown" };
	} catch {
		return { reason: "model config check returned invalid JSON", state: "unknown" };
	}
}

async function probeSchema(
	repoRoot: string,
	profile: LocalDevProfile,
): Promise<BootstrapProbeResult> {
	const database = localDatabaseUrls(profile).owner;
	const url = new URL(database);
	const env = {
		...process.env,
		PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
		PGHOST: url.hostname,
		PGPASSWORD: decodeURIComponent(url.password),
		PGPORT: url.port || "5432",
		PGSSLMODE: "disable",
		PGUSER: decodeURIComponent(url.username),
	};
	const result = captureCommandResult(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["--dir", "jobs/campus-agent-schema", "status"],
		{ cwd: repoRoot, env, timeout: 15_000 },
	);
	if (result.status !== 0 || result.error || result.timedOut) {
		return { reason: result.stderr.trim() || "schema status command failed", state: "unknown" };
	}
	try {
		const status = JSON.parse(result.stdout) as {
			legacyObjects?: string[];
			status?: "current" | "missing" | "pending" | "legacy";
		};
		if (status.status === "current") {
			return { state: "ready" };
		}
		if (status.status === "missing" || status.status === "pending") {
			return { state: "missing" };
		}
		if (status.status === "legacy") {
			return {
				reason: `legacy objects: ${(status.legacyObjects ?? []).join(", ")}`,
				state: "invalid",
			};
		}
		return { reason: "schema status response is invalid", state: "unknown" };
	} catch {
		return { reason: "schema status response is not JSON", state: "unknown" };
	}
}

async function probeSql(
	repoRoot: string,
	databaseUrl: string,
	sql: string,
	condition: { emptyIsMissing?: boolean; exact?: number; minimum?: number },
): Promise<BootstrapProbeResult> {
	const result = captureCommandResult(
		"psql",
		[databaseUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
		{ cwd: repoRoot, timeout: 10_000 },
	);
	if (result.status !== 0 || result.error || result.timedOut) {
		if (/does not exist|undefined table/u.test(result.stderr)) {
			return { state: "missing" };
		}
		return { reason: result.stderr.trim() || "database probe failed", state: "unknown" };
	}
	const count = Number(result.stdout.trim());
	if (!Number.isSafeInteger(count)) {
		return { reason: "database probe returned a non-integer", state: "unknown" };
	}
	if (condition.exact !== undefined && count === condition.exact) {
		return { state: "ready" };
	}
	if (condition.minimum !== undefined && count >= condition.minimum) {
		return { state: "ready" };
	}
	if (condition.minimum !== undefined) {
		return { state: "missing" };
	}
	if (condition.emptyIsMissing && count === 0) {
		return { state: "missing" };
	}
	return { reason: `database probe returned count=${count}`, state: "invalid" };
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
