import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { imageTargetsForScope } from "../release/image-targets.mts";
import { readNodeVersion } from "../toolchain/node-version.mts";
import {
	type AffectedScope,
	type CommandResult,
	type CommandRunner,
	resolveAffectedScope,
} from "./scope.mts";
import {
	isValidationProfile,
	VALIDATION_PROFILE_REGISTRY,
	type ValidationProfile,
} from "./validation-profiles.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PRE_PUSH_NODE_TASKS = ["typecheck", "test", "test:worker"] as const;
const PRE_PUSH_NATIVE_TASKS = ["native:typecheck", "native:test"] as const;

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
	profile: ValidationProfile | "pre-push",
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

function runAffectedTask(
	input: {
		profile: "pre-push";
		scope: AffectedScope;
		serialized: boolean;
		task: string;
	},
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
	const packages = [
		...new Set(
			input.scope.tasks
				.filter(({ task }) => task === input.task)
				.map(({ package: packageName }) => packageName),
		),
	].sort();
	if (packages.length === 0) {
		return;
	}
	runProfileCommand(
		input.profile,
		"pnpm",
		[
			"exec",
			"turbo",
			"run",
			input.task,
			"--only",
			...(input.serialized ? ["--concurrency=1"] : []),
			"--summarize",
			...packages.map((packageName) => `--filter=${packageName}`),
		],
		runner,
		options,
	);
}

function runAffectedNodeEvidence(
	input: {
		env: NodeJS.ProcessEnv;
		repositoryRoot: string;
		scope: AffectedScope;
	},
	runner: EvidenceCommandRunner,
): void {
	const options = { cwd: input.repositoryRoot, env: input.env };
	for (const taskName of ["test", "test:worker", "typecheck"] as const) {
		const packages = new Set(
			input.scope.tasks.filter((task) => task.task === taskName).map((task) => task.package),
		);
		if (packages.size > 0) {
			runProfileCommand(
				"affected-node",
				"pnpm",
				[
					"exec",
					"turbo",
					"run",
					taskName,
					"--only",
					"--summarize",
					...[...packages].sort().map((packageName) => `--filter=${packageName}`),
				],
				runner,
				options,
			);
		}
	}

	const buildPackages = new Set(
		input.scope.tasks
			.filter((task) => task.task === "build" && task.package !== "campus-web")
			.map((task) => task.package),
	);
	if (buildPackages.size > 0) {
		runProfileCommand(
			"affected-node",
			"pnpm",
			[
				"exec",
				"turbo",
				"run",
				"build",
				"--only",
				"--summarize",
				...[...buildPackages].sort().map((packageName) => `--filter=${packageName}`),
			],
			runner,
			options,
		);
	}

	const builtWorkers = new Set(
		input.scope.tasks.filter((task) => task.task === "build:worker").map((task) => task.package),
	);
	if (builtWorkers.size > 0) {
		runProfileCommand(
			"affected-node",
			"pnpm",
			[
				"exec",
				"turbo",
				"run",
				"build:worker",
				"--only",
				"--summarize",
				...[...builtWorkers].sort().map((packageName) => `--filter=${packageName}`),
			],
			runner,
			options,
		);
	}
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
	const images = imageTargetsForScope(input.scope);
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
	runProfileCommand("image-build", "node", args, runner, options);
}

export function runPrePushEvidence(
	input: {
		base?: string;
		head: string;
		repositoryRoot: string;
	},
	runner: EvidenceCommandRunner = runCommand,
): void {
	if (
		!SHA_PATTERN.test(input.head) ||
		(input.base !== undefined && !SHA_PATTERN.test(input.base))
	) {
		throw new Error("Pre-push evidence revisions must be full lowercase commit SHAs");
	}
	const env = {
		...process.env,
		...(input.base ? { TURBO_SCM_BASE: input.base } : {}),
		TURBO_SCM_HEAD: input.head,
	};
	const options = { cwd: input.repositoryRoot, env };
	if (!input.base) {
		runProfileCommand(
			"pre-push",
			"pnpm",
			["exec", "turbo", "run", ...PRE_PUSH_NODE_TASKS, "--summarize"],
			runner,
			options,
		);
		for (const task of PRE_PUSH_NATIVE_TASKS) {
			runProfileCommand(
				"pre-push",
				"pnpm",
				["exec", "turbo", "run", task, "--concurrency=1", "--summarize"],
				runner,
				options,
			);
		}
		return;
	}

	const scope = resolveAffectedScope(
		{
			base: input.base,
			head: input.head,
			repositoryRoot: input.repositoryRoot,
		},
		runner,
	);
	for (const task of PRE_PUSH_NODE_TASKS) {
		runAffectedTask({ profile: "pre-push", scope, serialized: false, task }, runner, options);
	}
	for (const task of PRE_PUSH_NATIVE_TASKS) {
		runAffectedTask({ profile: "pre-push", scope, serialized: true, task }, runner, options);
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
		base: string;
		head: string;
		profiles: ValidationProfile[];
		repository?: string;
		repositoryRoot: string;
		summaryFile?: string;
		eventFile?: string;
	},
	runner: EvidenceCommandRunner = runCommand,
): void {
	if (!(SHA_PATTERN.test(input.base) && SHA_PATTERN.test(input.head))) {
		throw new Error("Candidate evidence revisions must be full lowercase commit SHAs");
	}
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
		return executor.kind === "affected-node" || executor.kind === "affected-images";
	});
	const scope = requiresScope
		? resolveAffectedScope(
				{
					base: input.base,
					head: input.head,
					repositoryRoot: input.repositoryRoot,
				},
				runner,
			)
		: undefined;
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
	const profiles = parseValidationProfiles(required(values, "profiles"));
	runCandidateEvidence({
		base: required(values, "base"),
		head: required(values, "head"),
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
