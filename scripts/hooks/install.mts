import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface HookCommandResult {
	error?: Error;
	status: number | null;
	stderr?: string;
	stdout?: string;
}

export type HookCommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
) => HookCommandResult;

export type HookInstallResult =
	| { repositoryRoot: string; status: "installed" }
	| { reason: "ci" | "not-git-worktree" | "production"; status: "skipped" };

function runCommand(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
): HookCommandResult {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		env: options.env,
		maxBuffer: 4 * 1024 * 1024,
	});
	return {
		error: result.error,
		status: result.status,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? "",
	};
}

function commandError(command: string, args: string[], result: HookCommandResult): Error {
	if (result.error) {
		return result.error;
	}
	const detail =
		result.stderr?.trim() || result.stdout?.trim() || `exit code ${String(result.status ?? 1)}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

function requireSuccess(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
	runner: HookCommandRunner,
): HookCommandResult {
	const result = runner(command, args, options);
	if (result.error || result.status !== 0) {
		throw commandError(command, args, result);
	}
	return result;
}

function enabled(value: string | undefined): boolean {
	return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function productionInstall(env: NodeJS.ProcessEnv): boolean {
	return env.NODE_ENV === "production" || enabled(env.npm_config_production);
}

function repositoryRoot(
	cwd: string,
	env: NodeJS.ProcessEnv,
	runner: HookCommandRunner,
): string | undefined {
	const result = runner("git", ["rev-parse", "--show-toplevel"], { cwd, env });
	if (result.error || result.status !== 0) {
		return;
	}
	const root = result.stdout?.trim();
	return root ? path.resolve(root) : undefined;
}

// Keep Git's hook path worktree-local because each worktree has its own dependencies. `prek` owns
// the generated hook files; this adapter only configures the path and delegates installation.
export function installHooks(
	options: { cwd?: string; env?: NodeJS.ProcessEnv; runner?: HookCommandRunner } = {},
): HookInstallResult {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const env = options.env ?? process.env;
	const runner = options.runner ?? runCommand;
	if (enabled(env.CI)) {
		return { reason: "ci", status: "skipped" };
	}
	if (productionInstall(env)) {
		return { reason: "production", status: "skipped" };
	}
	const root = repositoryRoot(cwd, env, runner);
	if (!root) {
		return { reason: "not-git-worktree", status: "skipped" };
	}
	const commandOptions = { cwd: root, env };
	requireSuccess("git", ["config", "extensions.worktreeConfig", "true"], commandOptions, runner);
	requireSuccess(
		"git",
		["config", "--worktree", "core.hooksPath", ".githooks"],
		commandOptions,
		runner,
	);
	requireSuccess(
		"pnpm",
		["exec", "prek", "uninstall", "--hook-type", "pre-push"],
		commandOptions,
		runner,
	);
	requireSuccess("pnpm", ["exec", "prek", "install", "--force"], commandOptions, runner);
	const installedPath = requireSuccess(
		"git",
		["rev-parse", "--git-path", "hooks/pre-commit"],
		commandOptions,
		runner,
	).stdout?.trim();
	if (!installedPath) {
		throw new Error("Git did not resolve the installed pre-commit hook");
	}
	const hook = path.resolve(root, installedPath);
	if (!statSync(hook).isFile()) {
		throw new Error(`The pre-commit hook is not a file: ${hook}`);
	}
	accessSync(hook, constants.X_OK);
	return { repositoryRoot: root, status: "installed" };
}

function main(): void {
	const result = installHooks();
	if (result.status === "installed") {
		process.stdout.write(`Installed worktree-local Git hooks in ${result.repositoryRoot}\n`);
		return;
	}
	process.stdout.write(`Skipped Git hook installation: ${result.reason}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
