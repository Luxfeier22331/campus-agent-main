import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceCommandRunner } from "./evidence.mts";
import { planPrePush, runPrePush } from "./pre-push.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const ZERO_REF = "0".repeat(40);

function pushEnvironment(from: string, to: string): NodeJS.ProcessEnv {
	return { PRE_COMMIT_FROM_REF: from, PRE_COMMIT_TO_REF: to };
}

test("runs only affected Node and Go pre-push tasks", () => {
	const calls: Array<{
		args: string[];
		base?: string;
		command: string;
		head?: string;
	}> = [];
	const runner: EvidenceCommandRunner = (command, args, options) => {
		calls.push({
			args,
			base: options.env.TURBO_SCM_BASE,
			command,
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
		.filter(({ command, args }) => command === "pnpm" && !args.includes("--dry-run=json"))
		.map(({ command, args }) => [command, ...args].join(" "));
	assert.deepEqual(commands, [
		"pnpm exec turbo run typecheck --only --summarize --filter=agent-runtime",
		"pnpm exec turbo run test --only --summarize --filter=agent-runtime",
		"pnpm exec turbo run native:typecheck --only --concurrency=1 --summarize --filter=model-config",
		"pnpm exec turbo run native:test --only --concurrency=1 --summarize --filter=model-config",
	]);
	assert(!commands.some((command) => command.includes(" build")));
	assert(
		calls
			.filter(({ command }) => command === "pnpm")
			.every((call) => call.base === BASE && call.head === HEAD),
	);
});

test("runs the complete light task set when a new or rewritten branch has no usable base", () => {
	const calls: string[] = [];
	const runner: EvidenceCommandRunner = (command, args) => {
		calls.push([command, ...args].join(" "));
		return { status: 0 };
	};

	runPrePush({ env: pushEnvironment(ZERO_REF, HEAD), repositoryRoot: "/repository" }, runner);
	assert.deepEqual(calls, [
		"pnpm exec turbo run typecheck test test:worker --summarize",
		"pnpm exec turbo run native:typecheck --concurrency=1 --summarize",
		"pnpm exec turbo run native:test --concurrency=1 --summarize",
	]);

	assert.deepEqual(
		planPrePush({ env: pushEnvironment(BASE, HEAD), repositoryRoot: "/repository" }, () => ({
			status: 1,
		})),
		{ head: HEAD, kind: "full" },
	);
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
