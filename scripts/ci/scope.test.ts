import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	type CommandResult,
	type CommandRunner,
	parseChangedFiles,
	parseTurboTasks,
	resolveAffectedScope,
} from "./scope.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const BASE_TREE = "c".repeat(40);
const HEAD_TREE = "d".repeat(40);
const SYNTHETIC_BASE = "e".repeat(40);
const SYNTHETIC_HEAD = "f".repeat(40);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { status: 0, stderr: "", stdout: "", ...overrides };
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function writeTurboFixture(root: string, outputLogs?: string): void {
	const tasks = Object.fromEntries(
		["build", "build:worker", "test", "test:worker", "typecheck"].map((taskName) => [
			taskName,
			{
				inputs: ["$TURBO_DEFAULT$"],
				outputs: [],
				...(taskName === "test" && outputLogs ? { outputLogs } : {}),
			},
		]),
	);
	writeFileSync(
		path.join(root, "turbo.json"),
		`${JSON.stringify(
			{
				$schema: "https://turborepo.com/schema.json",
				futureFlags: { affectedUsingTaskInputs: true },
				tasks,
			},
			null,
			2,
		)}\n`,
	);
}

test("parses added, deleted, renamed, and copied paths from one structured diff", () => {
	assert.deepEqual(
		parseChangedFiles(
			[
				"A",
				"added.ts",
				"D",
				"deleted.go",
				"T",
				"changed-type.sh",
				"R100",
				"old-name.ts",
				"new-name.ts",
				"C75",
				"source.sh",
				"copy.sh",
				"",
			].join("\0"),
		),
		[
			"added.ts",
			"changed-type.sh",
			"copy.sh",
			"deleted.go",
			"new-name.ts",
			"old-name.ts",
			"source.sh",
		],
	);
	assert.throws(() => parseChangedFiles("R100\0only-one-path\0"), /incomplete/u);
});

test("keeps only executable Turbo tasks and rejects malformed plans", () => {
	assert.deepEqual(
		parseTurboTasks(
			JSON.stringify({
				tasks: [
					{ command: "tsc", package: "web", task: "typecheck" },
					{ command: "<NONEXISTENT>", package: "native", task: "build" },
					{ command: "go test", package: "control", task: "native:test" },
				],
			}),
		),
		[
			{ package: "control", task: "native:test" },
			{ package: "web", task: "typecheck" },
		],
	);
	assert.throws(() => parseTurboTasks("not-json"), /invalid affected plan/u);
});

test("validates ancestry, reads the diff once, and uses the lockfile Turbo", () => {
	const calls: Array<{ command: string; args: string[]; base?: string; head?: string }> = [];
	const runner: CommandRunner = (command, args, options) => {
		calls.push({
			command,
			args,
			base: options.env.TURBO_SCM_BASE,
			head: options.env.TURBO_SCM_HEAD,
		});
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [{ command: "vitest", package: "campus-web", task: "test" }],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({ stdout: "M\0apps/campus-web/src/app.tsx\0" });
		}
		return result();
	};
	assert.deepEqual(
		resolveAffectedScope({ base: BASE, head: HEAD, repositoryRoot: "/repository" }, runner),
		{
			base: BASE,
			changedFiles: ["apps/campus-web/src/app.tsx"],
			head: HEAD,
			tasks: [{ package: "campus-web", task: "test" }],
		},
	);
	assert.equal(calls.filter(({ args }) => args[0] === "diff").length, 1);
	const turbo = calls.find(({ command }) => command === "pnpm");
	assert.deepEqual(turbo?.args.slice(0, 3), ["exec", "turbo", "run"]);
	assert(!turbo?.args.includes("dlx"));
	assert(calls.every((call) => call.base === BASE && call.head === HEAD));
});

test("uses the head task graph once when a diff changes Turbo configuration", () => {
	const calls: Array<{ command: string; args: string[]; base?: string; head?: string }> = [];
	let commitCount = 0;
	const runner: CommandRunner = (command, args, options) => {
		calls.push({
			command,
			args,
			base: options.env.TURBO_SCM_BASE,
			head: options.env.TURBO_SCM_HEAD,
		});
		if (command === "git" && args[0] === "diff") {
			return result({ stdout: "M\0turbo.json\0M\0apps/campus-web/src/app.tsx\0" });
		}
		if (command === "git" && args[0] === "ls-tree") {
			return result({ stdout: `100644 blob ${BASE_TREE}\tturbo.json\0` });
		}
		if (command === "git" && args[0] === "write-tree") {
			return result({ stdout: `${SYNTHETIC_BASE}\n` });
		}
		if (command === "git" && args[0] === "rev-parse") {
			return result({ stdout: `${HEAD_TREE}\n` });
		}
		if (command === "git" && args[0] === "commit-tree") {
			commitCount += 1;
			return result({ stdout: `${commitCount === 1 ? SYNTHETIC_BASE : SYNTHETIC_HEAD}\n` });
		}
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [{ command: "vitest", package: "campus-web", task: "test" }],
				}),
			});
		}
		return result();
	};

	const scope = resolveAffectedScope(
		{ base: BASE, head: HEAD, repositoryRoot: "/repository" },
		runner,
	);
	assert.deepEqual(scope.changedFiles, ["apps/campus-web/src/app.tsx", "turbo.json"]);
	assert.deepEqual(scope.tasks, [{ package: "campus-web", task: "test" }]);
	assert.equal(calls.filter(({ command }) => command === "pnpm").length, 1);
	assert.equal(
		calls.filter(({ command, args }) => command === "git" && args[0] === "log").length,
		0,
	);
	const turbo = calls.find(({ command }) => command === "pnpm");
	assert.equal(turbo?.base, SYNTHETIC_BASE);
	assert.equal(turbo?.head, SYNTHETIC_HEAD);
});

test("applies renamed Turbo configuration paths to the synthetic base", () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const runner: CommandRunner = (command, args) => {
		calls.push({ command, args });
		if (command === "git" && args[0] === "diff") {
			return result({ stdout: "R100\0apps/old/turbo.json\0apps/new/turbo.json\0" });
		}
		if (
			command === "git" &&
			args[0] === "ls-tree" &&
			((args[2] === `${BASE}^{tree}` && args.at(-1) === "apps/old/turbo.json") ||
				(args[2] === `${HEAD}^{tree}` && args.at(-1) === "apps/new/turbo.json"))
		) {
			return result({ stdout: `100644 blob ${BASE_TREE}\t${args.at(-1)}\0` });
		}
		if (command === "git" && args[0] === "write-tree") {
			return result({ stdout: `${SYNTHETIC_BASE}\n` });
		}
		if (command === "git" && args[0] === "rev-parse") {
			return result({ stdout: `${HEAD_TREE}\n` });
		}
		if (command === "git" && args[0] === "commit-tree") {
			return result({ stdout: `${SYNTHETIC_BASE}\n` });
		}
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		return result();
	};

	const scope = resolveAffectedScope(
		{ base: BASE, head: HEAD, repositoryRoot: "/repository" },
		runner,
	);
	assert.deepEqual(scope.tasks, []);
	assert(
		calls.some(
			({ command, args }) =>
				command === "git" && args[0] === "update-index" && args[1] === "--force-remove",
		),
	);
	assert(
		calls.some(
			({ command, args }) =>
				command === "git" &&
				args[0] === "update-index" &&
				args[1] === "--add" &&
				args.at(-1) === "apps/new/turbo.json",
		),
	);
});

test("real Turbo keeps config-only scope empty without dropping source changes", (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "campus-agent-scope-test-"));
	t.after(() => rmSync(root, { force: true, recursive: true }));
	mkdirSync(path.join(root, "apps/web/src"), { recursive: true });
	symlinkSync(path.join(REPOSITORY_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
	writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
	writeFileSync(
		path.join(root, "package.json"),
		`${JSON.stringify({ name: "scope-fixture", packageManager: "pnpm@11.20.0", private: true })}\n`,
	);
	writeFileSync(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
	writeFileSync(
		path.join(root, "pnpm-lock.yaml"),
		"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n  apps/web: {}\n",
	);
	writeFileSync(
		path.join(root, "apps/web/package.json"),
		`${JSON.stringify({ name: "scope-web", scripts: { test: "node --test" } })}\n`,
	);
	writeFileSync(path.join(root, "apps/web/src/app.ts"), "export const value = 1;\n");
	writeTurboFixture(root);
	git(root, "init", "--quiet");
	git(root, "config", "user.email", "scope-test@example.invalid");
	git(root, "config", "user.name", "Scope test");
	git(root, "config", "commit.gpgSign", "false");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "base");
	const base = git(root, "rev-parse", "HEAD");

	writeTurboFixture(root, "new-only");
	git(root, "add", "turbo.json");
	git(root, "commit", "--quiet", "-m", "config only");
	const configOnly = git(root, "rev-parse", "HEAD");
	assert.deepEqual(
		resolveAffectedScope({ base, head: configOnly, repositoryRoot: root }).tasks,
		[],
	);

	git(root, "checkout", "--quiet", "--detach", base);
	writeTurboFixture(root, "full");
	writeFileSync(path.join(root, "apps/web/src/app.ts"), "export const value = 2;\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "config and source");
	const mixed = git(root, "rev-parse", "HEAD");
	const scope = resolveAffectedScope({ base, head: mixed, repositoryRoot: root });
	assert.deepEqual(scope.changedFiles, ["apps/web/src/app.ts", "turbo.json"]);
	assert(scope.tasks.some((task) => task.package === "scope-web" && task.task === "test"));
});

test("base equals head validates commits without diffing or running Turbo", () => {
	const calls: string[] = [];
	const scope = resolveAffectedScope(
		{ base: BASE, head: BASE, repositoryRoot: "/repository" },
		(command, args) => {
			calls.push(`${command} ${args.join(" ")}`);
			return result();
		},
	);
	assert.deepEqual(scope.changedFiles, []);
	assert.deepEqual(scope.tasks, []);
	assert.equal(calls.length, 3);
	assert(!calls.some((call) => call.startsWith("pnpm ") || call.includes(" diff ")));
});

test("rejects a base that is not an ancestor of head", () => {
	assert.throws(
		() =>
			resolveAffectedScope(
				{ base: BASE, head: HEAD, repositoryRoot: "/repository" },
				(_command, args) => (args[0] === "merge-base" ? result({ status: 1 }) : result()),
			),
		/merge-base/u,
	);
});
