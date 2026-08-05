import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

const AFFECTED_TASKS = ["build", "build:worker", "test", "test:worker", "typecheck"] as const;

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

function isTurboConfig(file: string): boolean {
	return file === "turbo.json" || file.endsWith("/turbo.json");
}

function run(
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

function requireSuccess(command: string, args: string[], result: CommandResult): CommandResult {
	if (result.error || result.status !== 0) {
		throw commandError(command, args, result);
	}
	return result;
}

export function parseTurboTasks(source: string): ScopeTask[] {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
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

function collectTurboTasks(
	base: string,
	head: string,
	root: string,
	runner: CommandRunner,
): ScopeTask[] {
	const env = { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head };
	const turboArgs = ["exec", "turbo", "run", ...AFFECTED_TASKS, "--affected", "--dry-run=json"];
	const turbo = requireSuccess("pnpm", turboArgs, runner("pnpm", turboArgs, { cwd: root, env }));
	return parseTurboTasks(turbo.stdout ?? "");
}

interface TreeEntry {
	mode: string;
	object: string;
}

function readTreeEntry(
	tree: string,
	file: string,
	root: string,
	runner: CommandRunner,
	env: NodeJS.ProcessEnv,
): TreeEntry | undefined {
	const args = ["ls-tree", "-z", tree, "--", file];
	const result = requireSuccess("git", args, runner("git", args, { cwd: root, env }));
	const source = result.stdout ?? "";
	if (source === "") {
		return;
	}
	const entries = source.split("\0").filter(Boolean);
	if (entries.length !== 1) {
		throw new Error(`Git returned multiple tree entries for ${file}`);
	}
	const separator = entries[0]?.indexOf("\t") ?? -1;
	const header = separator >= 0 ? entries[0]?.slice(0, separator).split(" ") : undefined;
	if (
		header?.length !== 3 ||
		header[1] !== "blob" ||
		!header[0] ||
		!header[2] ||
		!SHA_PATTERN.test(header[2])
	) {
		throw new Error(`Git returned an invalid tree entry for ${file}`);
	}
	return { mode: header[0], object: header[2] };
}

function commitTree(
	tree: string,
	message: string,
	parent: string | undefined,
	root: string,
	runner: CommandRunner,
	env: NodeJS.ProcessEnv,
): string {
	const args = ["commit-tree", tree];
	if (parent) {
		args.push("-p", parent);
	}
	args.push("-m", message);
	const commitEnv = {
		...env,
		GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
		GIT_AUTHOR_EMAIL: "ci-scope@example.invalid",
		GIT_AUTHOR_NAME: "Source CI scope",
		GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
		GIT_COMMITTER_EMAIL: "ci-scope@example.invalid",
		GIT_COMMITTER_NAME: "Source CI scope",
	};
	const result = requireSuccess("git", args, runner("git", args, { cwd: root, env: commitEnv }));
	const commit = result.stdout?.trim() ?? "";
	if (!SHA_PATTERN.test(commit)) {
		throw new Error("Git returned an invalid synthetic scope commit");
	}
	return commit;
}

function collectTurboTasksWithHeadConfig(
	base: string,
	head: string,
	configFiles: readonly string[],
	root: string,
	runner: CommandRunner,
): ScopeTask[] {
	const tempRoot = mkdtempSync(path.join(os.tmpdir(), "campus-agent-scope-"));
	const index = path.join(tempRoot, "index");
	const env = { ...process.env, GIT_INDEX_FILE: index };
	try {
		const readTreeArgs = ["read-tree", `${base}^{tree}`];
		requireSuccess("git", readTreeArgs, runner("git", readTreeArgs, { cwd: root, env }));

		for (const file of configFiles) {
			const baseEntry = readTreeEntry(`${base}^{tree}`, file, root, runner, env);
			const headEntry = readTreeEntry(`${head}^{tree}`, file, root, runner, env);
			if (headEntry) {
				const updateArgs = [
					"update-index",
					"--add",
					"--cacheinfo",
					headEntry.mode,
					headEntry.object,
					file,
				];
				requireSuccess("git", updateArgs, runner("git", updateArgs, { cwd: root, env }));
			} else if (baseEntry) {
				const removeArgs = ["update-index", "--force-remove", "--", file];
				requireSuccess("git", removeArgs, runner("git", removeArgs, { cwd: root, env }));
			}
		}

		const baseTreeResult = requireSuccess(
			"git",
			["write-tree"],
			runner("git", ["write-tree"], { cwd: root, env }),
		);
		const baseTree = baseTreeResult.stdout?.trim() ?? "";
		if (!SHA_PATTERN.test(baseTree)) {
			throw new Error("Git returned an invalid synthetic scope tree");
		}
		const syntheticBase = commitTree(
			baseTree,
			"synthetic Turbo scope base",
			undefined,
			root,
			runner,
			env,
		);
		const headTreeArgs = ["rev-parse", `${head}^{tree}`];
		const headTreeResult = requireSuccess(
			"git",
			headTreeArgs,
			runner("git", headTreeArgs, { cwd: root, env }),
		);
		const headTree = headTreeResult.stdout?.trim() ?? "";
		if (!SHA_PATTERN.test(headTree)) {
			throw new Error("Git returned an invalid affected head tree");
		}
		const syntheticHead = commitTree(
			headTree,
			"synthetic Turbo scope head",
			syntheticBase,
			root,
			runner,
			env,
		);
		return collectTurboTasks(syntheticBase, syntheticHead, root, runner);
	} finally {
		rmSync(tempRoot, { force: true, recursive: true });
	}
}

export function resolveAffectedScope(
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
	const turboConfigFiles = changedFiles.filter(isTurboConfig);
	return {
		base: options.base,
		changedFiles,
		head: options.head,
		tasks:
			turboConfigFiles.length > 0
				? collectTurboTasksWithHeadConfig(
						options.base,
						options.head,
						turboConfigFiles,
						root,
						runner,
					)
				: collectTurboTasks(options.base, options.head, root, runner),
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
