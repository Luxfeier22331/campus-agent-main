import assert from "node:assert/strict";
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

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { status: 0, stderr: "", stdout: "", ...overrides };
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
