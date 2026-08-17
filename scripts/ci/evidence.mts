import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readNodeVersion } from "../toolchain/node-version.mts";
import { type CommandResult, type CommandRunner, resolveAffectedScope } from "./scope.mts";
import {
	isValidationProfile,
	VALIDATION_PROFILE_REGISTRY,
	type ValidationProfile,
} from "./validation-profiles.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export type EvidenceCommandRunner = CommandRunner;

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
	profile: ValidationProfile,
	command: string,
	args: string[],
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
	const result = runner(command, args, options);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`Candidate validation profile ${profile} failed with exit code ${result.status ?? 1}`,
		);
	}
}

function runAffectedNodeEvidence(
	input: {
		base: string;
		env: NodeJS.ProcessEnv;
		head: string;
		repositoryRoot: string;
	},
	runner: EvidenceCommandRunner,
): void {
	const options = { cwd: input.repositoryRoot, env: input.env };
	const scope = resolveAffectedScope(
		{
			base: input.base,
			head: input.head,
			repositoryRoot: input.repositoryRoot,
		},
		runner,
	);
	for (const taskName of ["test", "test:worker", "typecheck"] as const) {
		const packages = new Set(
			scope.tasks.filter((task) => task.task === taskName).map((task) => task.package),
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
		scope.tasks
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
		scope.tasks.filter((task) => task.task === "build:worker").map((task) => task.package),
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
		repositoryRoot: string;
	},
	runner: EvidenceCommandRunner = runCommand,
): void {
	if (!(SHA_PATTERN.test(input.base) && SHA_PATTERN.test(input.head))) {
		throw new Error("Candidate evidence revisions must be full lowercase commit SHAs");
	}
	const env = {
		...process.env,
		...(input.profiles.includes("toolchain")
			? { NODE_VERSION: readNodeVersion(input.repositoryRoot) }
			: {}),
		TURBO_SCM_BASE: input.base,
		TURBO_SCM_HEAD: input.head,
	};
	const options = { cwd: input.repositoryRoot, env };
	for (const profile of input.profiles) {
		process.stdout.write(`Running validation profile: ${profile}\n`);
		const executor = VALIDATION_PROFILE_REGISTRY[profile].executor;
		if (executor.kind === "affected-node") {
			runAffectedNodeEvidence(
				{
					base: input.base,
					env,
					head: input.head,
					repositoryRoot: input.repositoryRoot,
				},
				runner,
			);
			continue;
		}
		for (const [command, ...args] of executor.commands) {
			runProfileCommand(profile, command, args, runner, options);
		}
	}
}

async function main(args: string[]): Promise<void> {
	const values = argumentsMap(args);
	runCandidateEvidence({
		base: required(values, "base"),
		head: required(values, "head"),
		profiles: parseValidationProfiles(required(values, "profiles")),
		repositoryRoot: path.resolve(values.get("root") ?? process.cwd()),
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
