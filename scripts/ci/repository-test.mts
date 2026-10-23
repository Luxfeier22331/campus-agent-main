import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type CommandRunner, requireSuccess } from "./scope.mts";
import {
	TOOLING_GROUPS,
	TOOLING_TRACKED_PATHS,
	type ToolingGroup,
	toolingTask,
} from "./tooling-tasks.mts";
import { nodeRuntimeEnvironment } from "./turbo.mts";

const run: CommandRunner = (command, args, options) => {
	const result = spawnSync(command, args, {
		...options,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		stdio: args.includes("turbo") ? "inherit" : "pipe",
	});
	return {
		error: result.error,
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

export function repositoryTestEnvironment(
	input: { repositoryRoot: string; env?: NodeJS.ProcessEnv },
	runner: CommandRunner = run,
): NodeJS.ProcessEnv {
	const options = { cwd: input.repositoryRoot, env: nodeRuntimeEnvironment(input.env) };
	const read = (command: string, args: string[]) =>
		requireSuccess(command, args, runner(command, args, options)).stdout?.trim() ?? "";
	for (const [group, paths] of Object.entries(TOOLING_TRACKED_PATHS)) {
		const tracked = read("git", ["ls-files", "--cached", "-z", "--", ...paths]);
		options.env[`CAMPUS_TOOLING_TRACKED_${group.toUpperCase()}`] = createHash("sha256")
			.update(JSON.stringify(tracked.split("\0").filter(Boolean).sort()))
			.digest("hex");
	}
	options.env.CAMPUS_REPO_TEST_RUNTIME = JSON.stringify({
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		git: read("git", ["--version"]),
		pnpm: read("pnpm", ["--version"]),
	});
	// Tests create their own Git repositories; do not redirect those commands to the caller's index.
	for (const name of read("git", ["rev-parse", "--local-env-vars"]).split(/\s+/u).filter(Boolean)) {
		delete options.env[name];
	}
	return options.env;
}

export function runRepositoryTests(
	input: {
		repositoryRoot: string;
		env?: NodeJS.ProcessEnv;
		args?: string[];
		groups?: readonly ToolingGroup[];
	},
	runner: CommandRunner = run,
): number {
	const options = { cwd: input.repositoryRoot, env: repositoryTestEnvironment(input, runner) };
	const args = [
		"exec",
		"turbo",
		"run",
		...(input.groups?.length ? input.groups : TOOLING_GROUPS).map(toolingTask),
		"--concurrency=1",
		"--summarize",
	];
	if (input.args?.length) {
		args.push("--", ...input.args);
	}
	const result = runner("pnpm", args, options);
	if (result.error) {
		throw result.error;
	}
	return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		const groupArg = process.argv.slice(2).find((arg) => arg.startsWith("--groups="));
		const groups = groupArg
			? (groupArg.slice("--groups=".length).split(",").filter(Boolean) as ToolingGroup[])
			: undefined;
		process.exitCode = runRepositoryTests({
			repositoryRoot: process.cwd(),
			args: process.argv.slice(2).filter((arg) => !arg.startsWith("--groups=")),
			...(groups ? { groups } : {}),
		});
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
