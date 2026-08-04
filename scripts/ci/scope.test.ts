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
const CONFIG_ONE = "c".repeat(40);
const CONFIG_TWO = "d".repeat(40);
const BEFORE_CONFIG_ONE = "e".repeat(40);
const BEFORE_CONFIG_TWO = "f".repeat(40);

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

test("splits cumulative affected scope around Turbo configuration commits", () => {
	const turboSegments: string[] = [];
	const runner: CommandRunner = (command, args, options) => {
		if (command === "git" && args[0] === "diff") {
			return result({
				stdout: "M\0apps/campus-web/src/app.tsx\0M\0apps/ops-web/turbo.json\0",
			});
		}
		if (command === "git" && args[0] === "log") {
			return result({ stdout: `${CONFIG_ONE}\n${CONFIG_TWO}\n` });
		}
		if (command === "git" && args[0] === "rev-list") {
			return result({ stdout: `${HEAD} ${CONFIG_TWO}\n` });
		}
		if (command === "git" && args[0] === "rev-parse") {
			return result({
				stdout: `${args[1] === `${CONFIG_ONE}^1` ? BEFORE_CONFIG_ONE : BEFORE_CONFIG_TWO}\n`,
			});
		}
		if (command === "pnpm") {
			const segment = `${options.env.TURBO_SCM_BASE}..${options.env.TURBO_SCM_HEAD}`;
			turboSegments.push(segment);
			const task =
				segment === `${BASE}..${BEFORE_CONFIG_ONE}`
					? { command: "vitest", package: "campus-web", task: "test" }
					: segment === `${CONFIG_ONE}..${BEFORE_CONFIG_TWO}`
						? { command: "vitest", package: "campus-web", task: "test" }
						: { command: "tsc", package: "ops-web", task: "typecheck" };
			return result({ stdout: JSON.stringify({ tasks: [task] }) });
		}
		return result();
	};

	const scope = resolveAffectedScope(
		{ base: BASE, head: HEAD, repositoryRoot: "/repository" },
		runner,
	);
	assert.deepEqual(turboSegments, [
		`${BASE}..${BEFORE_CONFIG_ONE}`,
		`${CONFIG_ONE}..${BEFORE_CONFIG_TWO}`,
		`${CONFIG_TWO}..${HEAD}`,
	]);
	assert.deepEqual(scope.tasks, [
		{ package: "campus-web", task: "test" },
		{ package: "ops-web", task: "typecheck" },
	]);
});

test("uses the pull request head behind a synthetic merge for task graph changes", () => {
	const pullRequestHead = "1".repeat(40);
	const taskGraphCommit = "2".repeat(40);
	const calls: Array<{ command: string; base?: string; head?: string }> = [];
	const runner: CommandRunner = (command, args, options) => {
		calls.push({ command, base: options.env.TURBO_SCM_BASE, head: options.env.TURBO_SCM_HEAD });
		if (command === "git" && args[0] === "diff") {
			return result({ stdout: "M\0turbo.json\0M\0apps/ops-web/src/server.ts\0" });
		}
		if (command === "git" && args[0] === "rev-list") {
			return result({ stdout: `${HEAD} ${BASE} ${pullRequestHead}\n` });
		}
		if (command === "git" && args[0] === "log") {
			assert(args.includes(`${BASE}..${pullRequestHead}`));
			return result({ stdout: `${taskGraphCommit}\n` });
		}
		if (command === "git" && args[0] === "rev-parse") {
			return result({ stdout: `${BASE}\n` });
		}
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [{ command: "tsc", package: "ops-web", task: "typecheck" }],
				}),
			});
		}
		return result();
	};

	const scope = resolveAffectedScope(
		{ base: BASE, head: HEAD, repositoryRoot: "/repository" },
		runner,
	);
	assert.equal(scope.head, HEAD);
	assert.deepEqual(scope.tasks, [{ package: "ops-web", task: "typecheck" }]);
	assert(
		calls.some(
			(call) =>
				call.command === "pnpm" && call.base === taskGraphCommit && call.head === pullRequestHead,
		),
	);
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
