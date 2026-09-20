import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readNodeVersion } from "../toolchain/node-version.mts";
import { imageScopeBetween } from "./image-scope.mts";
import {
	type AffectedScope,
	type CommandResult,
	type CommandRunner,
	parseTurboTasks,
	requireSuccess,
	resolveAffectedScope,
	resolveStagedTasks,
	type ScopeTask,
} from "./scope.mts";
import {
	ACTION_COMMANDS,
	BUILD_TASKS,
	CONTRACT_COMMAND,
	DATABASE_TASKS,
	EVAL_TASKS,
	isEvidenceTask,
	isValidationProfile,
	NATIVE_TASKS,
	NODE_TASKS,
	VALIDATION_PROFILE_REGISTRY,
	type ValidationProfile,
} from "./validation-profiles.mts";

type ExecutionProfile = ValidationProfile | "pre-commit" | "verify";

export type EvidenceCommandRunner = CommandRunner;

export interface EvidenceEvent {
	kind: "command" | "profile";
	profile: string;
	command?: string[];
	startedAt: string;
	status: "running" | "success" | "failure";
	finishedAt?: string;
	durationMs?: number;
	exitCode?: number | null;
	failureClass?: "runner" | "unknown";
}

function reportEvent(event: EvidenceEvent, env: NodeJS.ProcessEnv): void {
	if (env.CI_EVIDENCE_ENABLED !== "1") {
		return;
	}
	const line = JSON.stringify(event);
	if (env.CI_EVIDENCE_STDOUT === "1") {
		process.stdout.write(`CI_EVIDENCE ${line}\n`);
	}
	if (env.CI_EVIDENCE_FILE) {
		appendFileSync(env.CI_EVIDENCE_FILE, `${line}\n`);
	}
	if (env.GITHUB_STEP_SUMMARY && event.status !== "running") {
		// JSON inside a code block avoids interpreting command arguments as Markdown.
		appendFileSync(env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${line}\n\`\`\`\n`);
	}
}

export function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
): CommandResult {
	const captureOutput = command === "git" || args.includes("--dry-run=json");
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		stdio: captureOutput ? "pipe" : "inherit",
	});
	return {
		error: result.error,
		status: result.status,
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		stdout: typeof result.stdout === "string" ? result.stdout : "",
	};
}

function runProfileCommand(
	profile: ExecutionProfile,
	command: string,
	args: string[],
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
	const start = performance.now();
	const event: EvidenceEvent = {
		kind: "command",
		profile,
		command: [command, ...args],
		startedAt: new Date().toISOString(),
		status: "running",
	};
	reportEvent(event, options.env);
	let result: CommandResult | undefined;
	try {
		result = runner(command, args, options);
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error(
				`Candidate validation profile ${profile} failed with exit code ${result.status ?? 1}: ${command} ${args.join(" ")}`,
			);
		}
		event.status = "success";
	} finally {
		if (event.status === "running") {
			event.status = "failure";
		}
		reportEvent(
			{
				...event,
				finishedAt: new Date().toISOString(),
				durationMs: Math.round(performance.now() - start),
				exitCode: result?.status ?? null,
				...(event.status === "failure"
					? { failureClass: result?.error || !result ? ("runner" as const) : ("unknown" as const) }
					: {}),
			},
			options.env,
		);
	}
}

export function nodeTaskConcurrency(
	cpus: () => os.CpuInfo[] = os.cpus,
	constrainedMemory: () => number = process.constrainedMemory,
): number {
	const cpuLimit = Math.max(2, Math.floor(cpus().length / 2));
	const memory = constrainedMemory();
	// The 2 GiB runner cgroup OOM-killed tsc when three tasks ran together.
	const memoryLimit = memory > 0 ? Math.max(1, Math.floor(memory / 2 ** 31)) : cpuLimit;
	return Math.min(cpuLimit, memoryLimit);
}

export function runTasks(
	profile: ExecutionProfile,
	tasks: readonly string[],
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
	input: { scope?: readonly ScopeTask[]; native?: boolean; shell?: string } = {},
): void {
	let scope = input.scope;
	if (!scope) {
		const args = ["exec", "turbo", "run", ...tasks, "--dry-run=json"];
		scope = parseTurboTasks(
			requireSuccess("pnpm", args, runner("pnpm", args, options)).stdout ?? "",
		);
	}
	const selected = [
		...new Set(
			scope
				.filter(isEvidenceTask)
				.filter((item) => tasks.includes(item.task))
				.map((item) => `${item.package}#${item.task}`),
		),
	].sort();
	if (selected.length === 0) {
		return;
	}
	const args = [
		"--experimental-strip-types",
		"scripts/ci/turbo.mts",
		...selected,
		...(input.native ? ["--concurrency=1"] : [`--concurrency=${nodeTaskConcurrency()}`]),
		"--summarize",
	];
	const taskOptions = input.native
		? {
				...options,
				env: {
					...options.env,
					GOTOOLCHAIN: "local",
					CAMPUS_NATIVE_PLATFORM: `${process.platform}-${process.arch}`,
				},
			}
		: options;
	runProfileCommand(
		profile,
		input.shell ? "nix" : "node",
		input.shell ? ["develop", `.#${input.shell}`, "--command", "node", ...args] : args,
		runner,
		taskOptions,
	);
}

function runAffectedNodeEvidence(
	input: { env: NodeJS.ProcessEnv; repositoryRoot: string; scope: AffectedScope },
	runner: EvidenceCommandRunner,
): void {
	const options = { cwd: input.repositoryRoot, env: input.env };
	runTasks("affected-node", NODE_TASKS, runner, options, { scope: input.scope.tasks });
	// Campus Web's worker task owns its fixture build; do not also run the data-backed build.
	const builds = input.scope.tasks.filter(
		(task) => !(task.package === "campus-web" && task.task === "build"),
	);
	runTasks("affected-node", BUILD_TASKS, runner, options, { scope: builds });
}

function runAffectedImageEvidence(
	input: {
		repository: string;
		scope: AffectedScope;
		summaryFile?: string;
	},
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
	const images = imageScopeBetween(input.scope.base, input.scope.head, options.cwd, runner).images;
	if (images.length === 0) {
		return;
	}
	const args = [
		"--experimental-strip-types",
		"scripts/release/images.mts",
		"--mode",
		"build-only",
		"--images",
		JSON.stringify(images),
		"--repository",
		input.repository,
		"--source-sha",
		input.scope.head,
	];
	if (input.summaryFile) {
		args.push("--summary", input.summaryFile);
	}
	if (options.env.CI_IMAGE_CACHE_IMPORT_REGISTRIES) {
		args.push("--cache-import-registries", options.env.CI_IMAGE_CACHE_IMPORT_REGISTRIES);
	}
	if (options.env.CI_IMAGE_CACHE_EXPORT_REGISTRY) {
		args.push("--cache-export-registry", options.env.CI_IMAGE_CACHE_EXPORT_REGISTRY);
	}
	runProfileCommand("image-build", "node", args, runner, options);
}

export function runPreCommitEvidence(
	input: { repositoryRoot: string; env?: NodeJS.ProcessEnv },
	runner: EvidenceCommandRunner = runCommand,
): void {
	const options = { cwd: input.repositoryRoot, env: { ...(input.env ?? process.env) } };
	// The root test entry owns its cache context and cleans Git variables for fixture repositories.
	runProfileCommand(
		"pre-commit",
		"nix",
		["develop", ".#ci-core", "--command", "pnpm", "test"],
		runner,
		options,
	);
	const scope = resolveStagedTasks(
		{ repositoryRoot: input.repositoryRoot, env: options.env },
		runner,
	);
	const localGitVariables = runner("git", ["rev-parse", "--local-env-vars"], options);
	if (localGitVariables.error) {
		throw localGitVariables.error;
	}
	if (localGitVariables.status !== 0) {
		throw new Error("Cannot determine Git hook environment variables");
	}
	for (const name of (localGitVariables.stdout ?? "").split(/\s+/u).filter(Boolean)) {
		delete options.env[name];
	}
	runTasks("pre-commit", NODE_TASKS, runner, options, { scope, shell: "ci-core" });
	runTasks("pre-commit", NATIVE_TASKS, runner, options, { scope, shell: "ci-go", native: true });
}

export function runVerification(
	input: { sourceOnly: boolean; repositoryRoot: string },
	runner: EvidenceCommandRunner = runCommand,
): void {
	const options = { cwd: input.repositoryRoot, env: { ...process.env } };
	const command = (args: readonly [string, ...string[]]) =>
		runProfileCommand("verify", args[0], [...args.slice(1)], runner, options);
	command(["uv", "sync", "--locked", "--all-packages", "--dev"]);
	command(["pnpm", "check"]);
	runRepositoryCheck("contracts", input.repositoryRoot, runner);
	runRepositoryCheck("config", input.repositoryRoot, runner);
	runTasks("verify", NODE_TASKS, runner, options);
	runTasks("verify", NATIVE_TASKS, runner, options, { native: true });
	runTasks("verify", EVAL_TASKS, runner, options);
	if (input.sourceOnly) {
		return;
	}
	runTasks("verify", DATABASE_TASKS, runner, options, { native: true });
	runCandidateEvidence(
		{ profiles: ["infra", "otel", "container-build"], repositoryRoot: input.repositoryRoot },
		runner,
	);
}

export function runRepositoryCheck(
	check: string,
	repositoryRoot: string,
	runner: EvidenceCommandRunner = runCommand,
): void {
	const commands =
		check === "contracts" ? [CONTRACT_COMMAND] : check === "config" ? ACTION_COMMANDS : undefined;
	if (!commands) {
		throw new Error(`Unsupported repository check: ${check}`);
	}
	for (const [command, ...args] of commands) {
		runProfileCommand("verify", command, [...args], runner, {
			cwd: repositoryRoot,
			env: process.env,
		});
	}
}

function argumentsMap(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("Expected paired --name value arguments");
		}
		values.set(key.slice(2), value);
	}
	return values;
}

function required(values: Map<string, string>, name: string): string {
	const value = values.get(name);
	if (!value) {
		throw new Error(`Missing --${name}`);
	}
	return value;
}

export function parseValidationProfiles(source: string): ValidationProfile[] {
	const value = JSON.parse(source) as unknown;
	if (!Array.isArray(value)) {
		throw new Error("Candidate validation profiles must be a JSON array");
	}
	const selected = value.map((profile) => {
		if (typeof profile !== "string" || !isValidationProfile(profile)) {
			throw new Error(`Unsupported validation profile: ${String(profile)}`);
		}
		return profile;
	});
	if (new Set(selected).size !== selected.length) {
		throw new Error("Candidate validation profiles must be unique");
	}
	return selected;
}

export function runCandidateEvidence(
	input: {
		base?: string;
		head?: string;
		scope?: AffectedScope;
		profiles: ValidationProfile[];
		repository?: string;
		repositoryRoot: string;
		summaryFile?: string;
		eventFile?: string;
	},
	runner: EvidenceCommandRunner = runCommand,
): void {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		CI_EVIDENCE_ENABLED: runner === runCommand || input.eventFile ? "1" : "0",
		CI_EVIDENCE_STDOUT: runner === runCommand ? "1" : "0",
		CI_EVIDENCE_FILE: input.eventFile ?? process.env.CI_EVIDENCE_FILE,
		GITHUB_STEP_SUMMARY:
			runner === runCommand ? (input.summaryFile ?? process.env.GITHUB_STEP_SUMMARY) : undefined,
		...(input.profiles.includes("container-build") || input.profiles.includes("image-build")
			? { NODE_VERSION: readNodeVersion(input.repositoryRoot) }
			: {}),
		TURBO_SCM_BASE: input.base,
		TURBO_SCM_HEAD: input.head,
	};
	const options = { cwd: input.repositoryRoot, env };
	const requiresScope = input.profiles.some((profile) => {
		const executor = VALIDATION_PROFILE_REGISTRY[profile].executor;
		return (
			executor.kind === "affected-node" ||
			executor.kind === "affected-native" ||
			executor.kind === "affected-images"
		);
	});
	let scope = input.scope;
	if (requiresScope && !scope) {
		if (!(input.base && input.head)) {
			throw new Error("Affected validation requires --plan or --base and --head");
		}
		scope = resolveAffectedScope(
			{ base: input.base, head: input.head, repositoryRoot: input.repositoryRoot },
			runner,
		);
	}
	for (const profile of input.profiles) {
		const start = performance.now();
		const event: EvidenceEvent = {
			kind: "profile",
			profile,
			startedAt: new Date().toISOString(),
			status: "running",
		};
		reportEvent(event, env);
		try {
			const executor = VALIDATION_PROFILE_REGISTRY[profile].executor;
			if (executor.kind === "native" || executor.kind === "affected-native") {
				runTasks(profile, NATIVE_TASKS, runner, options, {
					native: true,
					...(executor.kind === "affected-native" ? { scope: scope?.tasks ?? [] } : {}),
				});
				event.status = "success";
				continue;
			}
			if (executor.kind === "affected-node") {
				if (!scope) {
					throw new Error(`Validation profile ${profile} requires an affected scope`);
				}
				runAffectedNodeEvidence(
					{
						env,
						repositoryRoot: input.repositoryRoot,
						scope,
					},
					runner,
				);
				event.status = "success";
				continue;
			}
			if (executor.kind === "affected-images") {
				if (!scope) {
					throw new Error(`Validation profile ${profile} requires an affected scope`);
				}
				if (!input.repository) {
					throw new Error("Image build evidence requires --repository");
				}
				runAffectedImageEvidence(
					{
						repository: input.repository,
						scope,
						summaryFile: input.summaryFile,
					},
					runner,
					options,
				);
				event.status = "success";
				continue;
			}
			for (const [command, ...args] of executor.commands) {
				runProfileCommand(profile, command, args, runner, options);
			}
			event.status = "success";
		} finally {
			if (event.status === "running") {
				event.status = "failure";
			}
			reportEvent(
				{
					...event,
					finishedAt: new Date().toISOString(),
					durationMs: Math.round(performance.now() - start),
				},
				env,
			);
		}
	}
}

async function main(args: string[]): Promise<void> {
	const values = argumentsMap(args);
	if (values.has("check")) {
		runRepositoryCheck(
			required(values, "check"),
			path.resolve(values.get("root") ?? process.cwd()),
		);
		return;
	}
	const verification = values.get("verify");
	if (verification !== undefined) {
		if (verification !== "full" && verification !== "source") {
			throw new Error("--verify must be full or source");
		}
		runVerification({
			sourceOnly: verification === "source",
			repositoryRoot: path.resolve(values.get("root") ?? process.cwd()),
		});
		return;
	}
	const planPath = values.get("plan");
	const plan = planPath
		? (JSON.parse(readFileSync(planPath, "utf8")) as {
				base: string;
				head: string;
				changedFiles: string[];
				affectedTasks: ScopeTask[];
			})
		: undefined;
	const profiles = parseValidationProfiles(required(values, "profiles"));
	runCandidateEvidence({
		base: values.get("base"),
		head: values.get("head"),
		...(plan
			? {
					scope: {
						base: plan.base,
						head: plan.head,
						changedFiles: plan.changedFiles,
						tasks: plan.affectedTasks,
					},
				}
			: {}),
		profiles,
		repository: values.get("repository"),
		repositoryRoot: path.resolve(values.get("root") ?? process.cwd()),
		summaryFile: values.get("summary"),
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
