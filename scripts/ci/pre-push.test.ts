import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceCommandRunner } from "./evidence.mts";
import { planPrePush, runPrePush } from "./pre-push.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const ZERO_REF = "0".repeat(40);

test("new branches use the available main merge-base without fetching", () => {
	const calls: string[] = [];
	const plan = planPrePush(
		{ env: pushEnvironment(ZERO_REF, HEAD), repositoryRoot: "/repository" },
		(command, args) => {
			calls.push([command, ...args].join(" "));
			return { status: 0, stdout: `${BASE}\n` };
		},
	);
	assert.deepEqual(plan, { kind: "affected", base: BASE, head: HEAD });
	assert.equal(calls.length, 2);
	assert(calls.every((command) => !command.includes("fetch")));
});

function pushEnvironment(from: string, to: string): NodeJS.ProcessEnv {
	return { PRE_COMMIT_FROM_REF: from, PRE_COMMIT_TO_REF: to };
}

test("runs root tests before affected Node and Go pre-push tasks", () => {
	const calls: Array<{
		args: string[];
		base?: string;
		command: string;
		cwd: string;
		head?: string;
	}> = [];
	const runner: EvidenceCommandRunner = (command, args, options) => {
		calls.push({
			args,
			base: options.env.TURBO_SCM_BASE,
			command,
			cwd: options.cwd,
			head: options.env.TURBO_SCM_HEAD,
		});
		if (command === "git" && args[0] === "diff") {
			return {
				status: 0,
				stdout: "M\0apps/agent-runtime/src/index.ts\0M\0apps/model-config/main.go\0",
			};
		}
		if (command === "pnpm" && args.includes("--dry-run=json")) {
			return {
				status: 0,
				stdout: JSON.stringify({
					tasks: [
						{ command: "tsc", package: "agent-runtime", task: "typecheck" },
						{ command: "vitest", package: "agent-runtime", task: "test" },
						{ command: "go vet", package: "model-config", task: "native:typecheck" },
						{ command: "lint", package: "model-config", task: "native:lint" },
						{ command: "format", package: "model-config", task: "native:format" },
						{ command: "go test", package: "model-config", task: "native:test" },
						{ command: "vite build", package: "agent-runtime", task: "build" },
					],
				}),
			};
		}
		return { status: 0 };
	};

	runPrePush({ env: pushEnvironment(BASE, HEAD), repositoryRoot: "/repository" }, runner);

	const commands = calls
		.filter(({ command, args }) => command === "nix" && !args.includes("--dry-run=json"))
		.map(({ command, args }) => [command, ...args].join(" "));
	assert.equal(commands.length, 3);
	assert.equal(commands[0], "nix develop .#ci-core --command pnpm test");
	assert.equal(calls.find(({ command }) => command === "nix")?.cwd, "/repository");
	const native = commands.find((command) => command.includes(".#ci-go"));
	assert(native?.includes("model-config#native:lint"));
	assert(native?.includes("model-config#native:format"));
	assert(native?.includes("model-config#native:test"));
	assert(native?.includes("model-config#native:typecheck"));
	assert(
		commands.some(
			(command) => command.includes(".#ci-core") && command.includes("agent-runtime#test"),
		),
	);

	assert(!commands.some((command) => command.includes(" build")));
	assert(
		calls
			.filter(({ command }) => command === "pnpm")
			.every((call) => call.base === BASE && call.head === HEAD),
	);
});

test("root test failure stops pre-push before affected task planning", () => {
	const calls: string[] = [];
	assert.throws(
		() =>
			runPrePush(
				{ env: pushEnvironment(BASE, HEAD), repositoryRoot: "/repository" },
				(command, args) => {
					calls.push([command, ...args].join(" "));
					return { status: command === "nix" ? 1 : 0 };
				},
			),
		/pre-push failed with exit code 1.*pnpm test/u,
	);
	assert.deepEqual(calls, [
		`git merge-base --is-ancestor ${BASE} ${HEAD}`,
		"git rev-parse --local-env-vars",
		"nix develop .#ci-core --command pnpm test",
	]);
});

test("runs root tests even when no module tasks are affected", () => {
	const commands: string[] = [];
	runPrePush(
		{ env: pushEnvironment(BASE, HEAD), repositoryRoot: "/repository" },
		(command, args) => {
			commands.push([command, ...args].join(" "));
			return { status: 0, stdout: "" };
		},
	);
	assert.deepEqual(
		commands.filter((command) => command.startsWith("nix ")),
		["nix develop .#ci-core --command pnpm test"],
	);
});

test("runs the complete light task set when a new or rewritten branch has no usable base", () => {
	const calls: string[] = [];
	const runner: EvidenceCommandRunner = (command, args) => {
		calls.push([command, ...args].join(" "));
		return { status: command === "git" && !args.includes("--local-env-vars") ? 1 : 0 };
	};

	runPrePush({ env: pushEnvironment(ZERO_REF, HEAD), repositoryRoot: "/repository" }, runner);
	assert.equal(
		calls.filter((command) => command === "nix develop .#ci-core --command pnpm test").length,
		1,
	);
	assert(
		calls.some(
			(command) => command.includes(".#ci-core") && command.includes("typecheck test test:worker"),
		),
	);
	assert(
		calls.some(
			(command) =>
				command.includes(".#ci-go") &&
				command.includes("native:format native:lint native:typecheck native:test"),
		),
	);
	assert(!calls.some((command) => command.includes(" fetch ")));

	assert.deepEqual(
		planPrePush({ env: pushEnvironment(BASE, HEAD), repositoryRoot: "/repository" }, () => ({
			status: 1,
		})),
		{ head: HEAD, kind: "full" },
	);
});

test("root tests do not inherit hook-local Git paths or alter the caller environment", () => {
	const env = {
		...pushEnvironment(BASE, HEAD),
		GIT_DIR: "/repository/.git",
		GIT_WORK_TREE: "/repository",
		GIT_INDEX_FILE: "/repository/.git/index",
		GIT_COMMON_DIR: "/repository/.git",
		PATH: "/test/bin",
	};
	let rootTestsRan = false;
	runPrePush({ env, repositoryRoot: "/repository" }, (command, args, options) => {
		if (command === "git" && args.includes("--local-env-vars")) {
			return {
				status: 0,
				stdout: "GIT_DIR\nGIT_WORK_TREE\nGIT_INDEX_FILE\nGIT_COMMON_DIR\n",
			};
		}
		if (command === "nix") {
			rootTestsRan = true;
			assert.equal(options.env.GIT_DIR, undefined);
			assert.equal(options.env.GIT_WORK_TREE, undefined);
			assert.equal(options.env.GIT_INDEX_FILE, undefined);
			assert.equal(options.env.GIT_COMMON_DIR, undefined);
			assert.equal(options.env.PATH, env.PATH);
			assert.equal(options.cwd, "/repository");
		}
		return { status: 0, stdout: "" };
	});
	assert(rootTestsRan);
	assert.equal(env.GIT_DIR, "/repository/.git");
	assert.equal(env.GIT_WORK_TREE, "/repository");
	assert.equal(env.GIT_INDEX_FILE, "/repository/.git/index");
	assert.equal(env.GIT_COMMON_DIR, "/repository/.git");
});

test("skips remote branch deletion and rejects invalid push refs", () => {
	let calls = 0;
	runPrePush({ env: pushEnvironment(BASE, ZERO_REF), repositoryRoot: "/repository" }, () => {
		calls += 1;
		return { status: 0 };
	});
	assert.equal(calls, 0);
	assert.throws(
		() => planPrePush({ env: {}, repositoryRoot: "/repository" }),
		/Missing PRE_COMMIT_FROM_REF/u,
	);
	assert.throws(
		() =>
			planPrePush({
				env: pushEnvironment("not-a-sha", HEAD),
				repositoryRoot: "/repository",
			}),
		/full lowercase commit SHA/u,
	);
});
