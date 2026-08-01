import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { turboTasks, type ValidationProfile } from "./candidates.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROFILE_COMMANDS: Record<ValidationProfile, string[][]> = {
	"affected-node": [],
	go: [["pnpm", "ci:go"]],
	"app-api-migration": [["pnpm", "ci:app-api-migration"]],
	"app-api-product-db": [["pnpm", "ci:app-api-product-db"]],
	"execution-control-postgres": [["pnpm", "ci:execution-control-postgres"]],
	"ops-web-postgres": [["pnpm", "ci:ops-web-postgres"]],
	infra: [["pnpm", "ci:infra"]],
	"release-tooling": [
		["pnpm", "ci:release"],
		["docker", "buildx", "bake", "--file", "docker-bake.hcl", "--print"],
	],
};

export interface EvidenceCommandResult {
	error?: Error;
	status: number | null;
	stdout?: string;
}

export type EvidenceCommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
) => EvidenceCommandResult;

function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
): EvidenceCommandResult {
	const captureOutput = args.includes("--dry=json");
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env,
		encoding: "utf8",
		stdio: captureOutput ? "pipe" : "inherit",
	});
	return {
		error: result.error,
		status: result.status,
		...(captureOutput && typeof result.stdout === "string" ? { stdout: result.stdout } : {}),
	};
}

function runProfileCommand(
	profile: ValidationProfile,
	command: string,
	args: string[],
	runner: EvidenceCommandRunner,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): void {
	if (!command) {
		throw new Error(`Missing command for candidate validation profile: ${profile}`);
	}
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
		repositoryRoot: string;
		env: NodeJS.ProcessEnv;
	},
	runner: EvidenceCommandRunner,
): void {
	const options = { cwd: input.repositoryRoot, env: input.env };
	const planResult = runner(
		"pnpm",
		[
			"exec",
			"turbo",
			"run",
			"build",
			"build:worker",
			"test",
			"typecheck",
			"--affected",
			"--dry=json",
		],
		options,
	);
	if (planResult.error) {
		throw planResult.error;
	}
	if (planResult.status !== 0) {
		throw new Error(
			`Candidate validation profile affected-node failed with exit code ${planResult.status ?? 1}`,
		);
	}
	const tasks = turboTasks(planResult.stdout ?? "");

	runProfileCommand(
		"affected-node",
		"pnpm",
		["exec", "turbo", "run", "test", "typecheck", "--affected", "--concurrency=1", "--summarize"],
		runner,
		options,
	);

	const buildPackages = [
		...new Set(
			tasks
				.filter((task) => task.task === "build" && task.package !== "campus-web")
				.map((task) => task.package),
		),
	].sort();
	if (buildPackages.length > 0) {
		const buildArgs = [
			"exec",
			"turbo",
			"run",
			"build",
			"--only",
			"--concurrency=1",
			"--summarize",
			...buildPackages.map((packageName) => `--filter=${packageName}`),
		];
		runProfileCommand("affected-node", "pnpm", buildArgs, runner, options);
	}

	if (tasks.some((task) => task.package === "campus-web" && task.task === "build:worker")) {
		runProfileCommand(
			"affected-node",
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
		if (typeof profile !== "string" || !Object.hasOwn(PROFILE_COMMANDS, profile)) {
			throw new Error(`Unsupported candidate validation profile: ${String(profile)}`);
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
	for (const profile of input.profiles) {
		process.stdout.write(`Running candidate validation profile: ${profile}\n`);
		if (profile === "affected-node") {
			runAffectedNodeEvidence({ repositoryRoot: input.repositoryRoot, env }, runner);
			continue;
		}
		for (const [command, ...args] of PROFILE_COMMANDS[profile]) {
			runProfileCommand(profile, command, args, runner, {
				cwd: input.repositoryRoot,
				env,
			});
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
