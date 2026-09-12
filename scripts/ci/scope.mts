import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BUILD_TASKS, NATIVE_TASKS, NODE_TASKS } from "./validation-profiles.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

const AFFECTED_TASKS = [...NODE_TASKS, ...NATIVE_TASKS, ...BUILD_TASKS];

export interface CommandResult {
	error?: Error;
	status: number | null;
	stderr?: string;
	stdout?: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
) => CommandResult;

export interface ScopeTask {
	package: string;
	task: string;
}

export interface AffectedScope {
	base: string;
	changedFiles: string[];
	head: string;
	tasks: ScopeTask[];
}

export interface AffectedScopeOptions {
	base: string;
	collectAffected?: boolean;
	head: string;
	repositoryRoot: string;
}

export function run(
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv },
): CommandResult {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		env: options.env,
		maxBuffer: 32 * 1024 * 1024,
	});
	return {
		error: result.error,
		status: result.status,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? "",
	};
}

function commandError(command: string, args: string[], result: CommandResult): Error {
	if (result.error) {
		return result.error;
	}
	const detail =
		result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status ?? 1}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

export function requireSuccess(
	command: string,
	args: string[],
	result: CommandResult,
): CommandResult {
	if (result.error || result.status !== 0) {
		throw commandError(command, args, result);
	}
	return result;
}

export function parseTurboTasks(source: string): ScopeTask[] {
	let value: unknown;
	try {
		const jsonStart = source.indexOf("{");
		if (jsonStart < 0) {
			throw new Error("Turbo affected plan does not contain a JSON object");
		}
		value = JSON.parse(source.slice(jsonStart)) as unknown;
	} catch (error) {
		throw new Error("Turbo returned an invalid affected plan", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Turbo affected plan must be an object");
	}
	const tasks = (value as { tasks?: unknown }).tasks;
	if (!Array.isArray(tasks)) {
		throw new Error("Turbo affected plan does not contain tasks");
	}
	return tasks
		.flatMap((task): ScopeTask[] => {
			if (
				typeof task === "object" &&
				task !== null &&
				!Array.isArray(task) &&
				typeof (task as { package?: unknown }).package === "string" &&
				typeof (task as { task?: unknown }).task === "string" &&
				typeof (task as { command?: unknown }).command === "string" &&
				(task as { command: string }).command !== "<NONEXISTENT>"
			) {
				return [
					{
						package: (task as { package: string }).package,
						task: (task as { task: string }).task,
					},
				];
			}
			return [];
		})
		.sort((left, right) =>
			`${left.package}\0${left.task}`.localeCompare(`${right.package}\0${right.task}`),
		);
}

export function parseChangedFiles(source: string): string[] {
	if (source.length === 0) {
		return [];
	}
	const fields = source.split("\0");
	if (fields.at(-1) === "") {
		fields.pop();
	}
	const files = new Set<string>();
	for (let index = 0; index < fields.length; ) {
		const status = fields[index++];
		if (!(status && /^[ACDMRT][0-9]*$/u.test(status))) {
			throw new Error("Git returned an invalid name-status diff");
		}
		const paths = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
		for (let offset = 0; offset < paths; offset += 1) {
			const file = fields[index++];
			if (!file) {
				throw new Error("Git returned an incomplete name-status diff");
			}
			files.add(file);
		}
	}
	return [...files].sort();
}

export function collectTurboTasks(
	base: string,
	head: string,
	root: string,
	runner: CommandRunner,
	tasks: readonly string[] = AFFECTED_TASKS,
): ScopeTask[] {
	const env = { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head };
	const turboArgs = ["exec", "turbo", "run", ...tasks, "--affected", "--dry-run=json"];
	const turbo = requireSuccess("pnpm", turboArgs, runner("pnpm", turboArgs, { cwd: root, env }));
	return parseTurboTasks(turbo.stdout ?? "");
}

export function resolveGitScope(
	options: AffectedScopeOptions,
	runner: CommandRunner = run,
): AffectedScope {
	if (!(SHA_PATTERN.test(options.base) && SHA_PATTERN.test(options.head))) {
		throw new Error("Affected scope revisions must be full lowercase commit SHAs");
	}
	const root = path.resolve(options.repositoryRoot);
	const env = {
		...process.env,
		TURBO_SCM_BASE: options.base,
		TURBO_SCM_HEAD: options.head,
	};
	for (const args of [
		["cat-file", "-e", `${options.base}^{commit}`],
		["cat-file", "-e", `${options.head}^{commit}`],
		["merge-base", "--is-ancestor", options.base, options.head],
	]) {
		requireSuccess("git", args, runner("git", args, { cwd: root, env }));
	}

	if (options.collectAffected === false || options.base === options.head) {
		return { base: options.base, changedFiles: [], head: options.head, tasks: [] };
	}

	const diffArgs = [
		"diff",
		"--name-status",
		"-z",
		"--diff-filter=ACDMRT",
		options.base,
		options.head,
	];
	const diff = requireSuccess("git", diffArgs, runner("git", diffArgs, { cwd: root, env }));
	const changedFiles = parseChangedFiles(diff.stdout ?? "");
	return { base: options.base, head: options.head, changedFiles, tasks: [] };
}

export function resolveAffectedScope(
	options: AffectedScopeOptions,
	runner: CommandRunner = run,
): AffectedScope {
	const scope = resolveGitScope(options, runner);
	return {
		...scope,
		tasks:
			scope.changedFiles.length > 0
				? collectTurboTasks(scope.base, scope.head, options.repositoryRoot, runner)
				: [],
	};
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

function main(args: string[]): void {
	const values = argumentsMap(args);
	const scope = resolveAffectedScope({
		base: required(values, "base"),
		head: required(values, "head"),
		repositoryRoot: values.get("root") ?? process.cwd(),
	});
	process.stdout.write(`${JSON.stringify(scope, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
