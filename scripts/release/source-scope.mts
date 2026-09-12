import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type AffectedScope,
	type AffectedScopeOptions,
	type CommandRunner,
	collectTurboTasks,
	requireSuccess,
	resolveGitScope,
	run,
	type ScopeTask,
} from "../ci/scope.mts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
// Release ignores task-config-only changes when selecting business artifacts.
// Validation deliberately uses the real revisions instead.
const RELEASE_TASKS = [
	"build",
	"build:worker",
	"native:test",
	"native:typecheck",
	"test",
	"test:worker",
	"typecheck",
];

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
		return collectTurboTasks(syntheticBase, syntheticHead, root, runner, RELEASE_TASKS);
	} finally {
		rmSync(tempRoot, { force: true, recursive: true });
	}
}

export function resolveReleaseScope(
	options: AffectedScopeOptions,
	runner: CommandRunner = run,
): AffectedScope {
	const scope = resolveGitScope(options, runner);
	if (scope.changedFiles.length === 0) {
		return scope;
	}
	const configs = scope.changedFiles.filter(
		(file) => file === "turbo.json" || file.endsWith("/turbo.json"),
	);
	return {
		...scope,
		tasks:
			configs.length > 0
				? collectTurboTasksWithHeadConfig(
						scope.base,
						scope.head,
						configs,
						options.repositoryRoot,
						runner,
					)
				: collectTurboTasks(scope.base, scope.head, options.repositoryRoot, runner, RELEASE_TASKS),
	};
}
