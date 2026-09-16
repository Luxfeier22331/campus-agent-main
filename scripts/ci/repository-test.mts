import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type CommandRunner, requireSuccess } from "./scope.mts";

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

export function runRepositoryTests(
	input: { repositoryRoot: string; env?: NodeJS.ProcessEnv; args?: string[] },
	runner: CommandRunner = run,
): number {
	const options = { cwd: input.repositoryRoot, env: { ...(input.env ?? process.env) } };
	const read = (command: string, args: string[]) =>
		requireSuccess(command, args, runner(command, args, options)).stdout?.trim() ?? "";
	// The suite reads the index's tracked paths. A commit ID would invalidate identical content.
	options.env.CAMPUS_REPO_TEST_INDEX_TREE = read("git", ["write-tree"]);
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
	const args = ["exec", "turbo", "run", "//#test:scripts", "--summarize"];
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
		process.exitCode = runRepositoryTests({
			repositoryRoot: process.cwd(),
			args: process.argv.slice(2),
		});
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
