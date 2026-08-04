import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { type CommandResult, type CommandRunner, resolveAffectedScope } from "./scope.mts";
import { VALIDATION_PROFILES, type ValidationProfile } from "./validation.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROFILE_COMMANDS: Partial<Record<ValidationProfile, string[][]>> = {
	go: [["pnpm", "ci:go"]],
	rust: [["pnpm", "ci:rust"]],
	ragas: [["pnpm", "ci:eval"]],
	"app-api-migration": [["pnpm", "ci:app-api-migration"]],
	"app-api-product-db": [["pnpm", "ci:app-api-product-db"]],
	"execution-control-postgres": [["pnpm", "ci:execution-control-postgres"]],
	"ingestion-control-postgres": [["pnpm", "ci:ingestion-control-postgres"]],
	"ops-web-postgres": [["pnpm", "ci:ops-web-postgres"]],
	infra: [["pnpm", "ci:infra"]],
	otel: [["pnpm", "ci:otel"]],
	dependencies: [["pnpm", "ci:deps"]],
	toolchain: [
		["pnpm", "ci:release"],
		["docker", "buildx", "bake", "--file", "docker-bake.hcl", "--print"],
	],
};

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
): { builtPackages: Set<string>; builtWorkers: Set<string> } {
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
					"--concurrency=1",
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
				"--concurrency=1",
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
				"--concurrency=1",
				"--summarize",
				...[...builtWorkers].sort().map((packageName) => `--filter=${packageName}`),
			],
			runner,
			options,
		);
	}
	return { builtPackages: buildPackages, builtWorkers };
}

function prepareCampusBrowser(
	prepared: boolean,
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
	if (prepared) {
		return;
	}
	runProfileCommand(
		"campus-browser-smoke",
		"pnpm",
		[
			"exec",
			"turbo",
			"run",
			"build:worker",
			"--filter=campus-web",
			"--only",
			"--concurrency=1",
			"--summarize",
		],
		runner,
		options,
	);
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
		if (
			typeof profile !== "string" ||
			!VALIDATION_PROFILES.includes(profile as ValidationProfile)
		) {
			throw new Error(`Unsupported validation profile: ${String(profile)}`);
		}
		return profile as ValidationProfile;
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
		TURBO_SCM_BASE: input.base,
		TURBO_SCM_HEAD: input.head,
	};
	const options = { cwd: input.repositoryRoot, env };
	let builtPackages = new Set<string>();
	let builtWorkers = new Set<string>();
	for (const profile of input.profiles) {
		process.stdout.write(`Running validation profile: ${profile}\n`);
		if (profile === "affected-node") {
			({ builtPackages, builtWorkers } = runAffectedNodeEvidence(
				{
					base: input.base,
					env,
					head: input.head,
					repositoryRoot: input.repositoryRoot,
				},
				runner,
			));
			continue;
		}
		if (profile === "campus-browser-smoke" || profile === "campus-browser-full") {
			prepareCampusBrowser(builtWorkers.has("campus-web"), runner, options);
			builtWorkers.add("campus-web");
			runProfileCommand(
				profile,
				"pnpm",
				[
					"--dir",
					"apps/campus-web",
					profile === "campus-browser-full" ? "test:e2e:full" : "test:e2e:smoke",
				],
				runner,
				options,
			);
			continue;
		}
		if (profile === "ops-web-browser") {
			runProfileCommand(
				profile,
				"pnpm",
				builtPackages.has("ops-web")
					? ["--dir", "apps/ops-web", "exec", "playwright", "test", "--config", "browser.config.ts"]
					: ["--dir", "apps/ops-web", "test:browser"],
				runner,
				options,
			);
			continue;
		}
		for (const [command, ...args] of PROFILE_COMMANDS[profile] ?? []) {
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
