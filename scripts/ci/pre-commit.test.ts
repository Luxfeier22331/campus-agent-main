import assert from "node:assert/strict";
import test from "node:test";
import { nodeTaskConcurrency, runPreCommitEvidence } from "./evidence.mts";
import { runRepositoryTests } from "./repository-test.mts";
import { type CommandRunner, resolveStagedTasks } from "./scope.mts";
import { TOOLING_GROUPS, toolingTask } from "./tooling-tasks.mts";
import { validationPlanFromScope } from "./validation.mts";

const head = "a".repeat(40);
const plan = JSON.stringify({
	tasks: [
		{ package: "web", task: "test:unit", command: "node test.cjs" },
		{ package: "web", task: "typecheck", command: "tsc --noEmit" },
		{ package: "model-config", task: "native:test", command: "go test" },
	],
});

function stagedRunner(calls: string[]): CommandRunner {
	return (command, args, options) => {
		calls.push([command, ...args].join(" "));
		if (command === "git" && args[0] === "diff") {
			return { status: 0, stdout: "M\0apps/web/src.ts\0" };
		}
		if (args.includes("--local-env-vars")) {
			return { status: 0, stdout: "GIT_DIR\nGIT_INDEX_FILE\n" };
		}
		if (command === "git") {
			return { status: 0, stdout: head };
		}
		if (args.includes("--dry-run=json")) {
			if (options.env.TURBO_SCM_BASE !== head || options.env.TURBO_SCM_HEAD !== undefined) {
				throw new Error(
					"Planner must select the staged worktree from HEAD, ignoring stale range variables",
				);
			}
			return { status: 0, stdout: plan };
		}
		if (command === "nix" && args.includes("turbo") && options.env.GIT_INDEX_FILE !== undefined) {
			throw new Error("Module tests inherited hook index");
		}
		return { status: 0 };
	};
}

test("commit verification runs root tests before staged Node/Go tasks without needing remote refs", () => {
	const calls: string[] = [];
	const env = {
		GIT_INDEX_FILE: "/tmp/commit-index",
		TURBO_SCM_HEAD: "stale",
		TURBO_SCM_BASE: "stale",
	};
	runPreCommitEvidence({ repositoryRoot: "/repo", env }, stagedRunner(calls));
	assert.equal(calls[0], "git diff --cached --name-status -z --diff-filter=ACDMRT");
	assert(calls.some((c) => c.includes("web#test:unit")));
	assert(calls.some((c) => c.includes("web#typecheck")));
	assert(calls.some((c) => c.includes("model-config#native:test")));
	assert(!calls.some((c) => /fetch|origin|merge-base/u.test(c)));
	assert.equal(env.GIT_INDEX_FILE, "/tmp/commit-index");
});

test("root failure prevents task selection and module failures stop subsequent phases", () => {
	const calls: string[] = [];
	assert.throws(
		() =>
			runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, (command, args) => {
				calls.push([command, ...args].join(" "));
				return { status: 17 };
			}),
		/git diff.*17/u,
	);
	assert.equal(calls.length, 1);
	calls.length = 0;
	const runner = stagedRunner(calls);
	assert.throws(
		() =>
			runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, (command, args, options) => {
				const result = runner(command, args, options);
				return args.includes("web#test:unit") && !args.includes("--dry-run=json")
					? { status: 9 }
					: result;
			}),
		/pre-commit failed.*9/u,
	);
	assert(!calls.some((c) => c.includes(".#ci-go")));
});

test("commit verification runs only selected tooling groups before package tasks", () => {
	const calls: string[] = [];
	const runner = stagedRunner(calls);
	runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, (command, args, options) => {
		const result = runner(command, args, options);
		return command === "git" && args[0] === "diff"
			? { status: 0, stdout: "M\0scripts/dev/environment.ts\0" }
			: result;
	});
	const tooling = "nix develop .#ci-core --command pnpm test:tooling --groups=dev";
	assert.deepEqual(
		calls.filter((call) => call.includes("pnpm test")),
		[tooling],
	);
	assert(calls.indexOf(tooling) < calls.findIndex((call) => call.includes("web#test:unit")));
});

test("an empty index diff skips module tasks; an unborn HEAD selects the complete set", () => {
	const calls: string[] = [];
	runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, (command, args) => {
		calls.push([command, ...args].join(" "));
		return { status: 0, stdout: "" };
	});
	assert.equal(calls.filter((c) => c.startsWith("nix ")).length, 0);
	assert.equal(
		resolveStagedTasks({ repositoryRoot: "/repo", env: {} }, (_command, args) =>
			args[0] === "diff" ? { status: 0, stdout: "A\0new.ts\0" } : { status: 1 },
		),
		undefined,
	);
	assert.throws(
		() =>
			resolveStagedTasks({ repositoryRoot: "/repo", env: {} }, () => ({
				status: 128,
				stderr: "broken repository",
			})),
		/broken repository/u,
	);
});

test("staged and PR scopes select the same contracts and Actions checks before tooling", () => {
	for (const [files, expected] of [
		[["packages/contracts/schemas/example.json"], ["contracts"]],
		[["configs/runtime/tools.json"], ["contracts"]],
		[["docs/contracts/schemas/example.yaml"], ["contracts"]],
		[[".github/workflows/pr.yml"], ["config"]],
		[["flake.nix", "flake.lock", "nix/tools.nix"], ["config"]],
		[
			["packages/contracts/README.md", ".github/workflows/pr.yml"],
			["contracts", "config"],
		],
		[["apps/web/src.ts", "packages/contracts-other/src.ts"], []],
	]) {
		const calls: string[] = [];
		const runner = stagedRunner(calls);
		runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, (command, args, options) => {
			const result = runner(command, args, options);
			return command === "git" && args[0] === "diff"
				? { status: 0, stdout: files.map((file) => `M\0${file}\0`).join("") }
				: result;
		});
		const checks = calls.filter((call) => /contracts:check|actionlint|zizmor/u.test(call));
		assert.deepEqual(checks, [
			...(expected.includes("contracts")
				? ["nix develop .#ci-go --command pnpm --dir packages/contracts contracts:check"]
				: []),
			...(expected.includes("config")
				? [
						"nix develop .#ci-light --command actionlint",
						"nix develop .#ci-light --command zizmor --min-severity=medium .github",
					]
				: []),
		]);
		assert.deepEqual(
			validationPlanFromScope({ base: head, head, changedFiles: [...files], tasks: [] })
				.lightSurfaces,
			expected,
		);
		const toolingIndex = calls.findIndex((call) => call.includes("test:tooling"));
		if (toolingIndex >= 0) {
			assert(checks.every((check) => calls.indexOf(check) < toolingIndex));
		}
	}
});

test("contract failure stops pre-commit before tooling or package selection", () => {
	const calls: string[] = [];
	const runner = stagedRunner(calls);
	assert.throws(
		() =>
			runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, (command, args, options) => {
				const result = runner(command, args, options);
				if (command === "git" && args[0] === "diff") {
					return { status: 0, stdout: "M\0docs/contracts/schemas/example.yaml\0" };
				}
				return args.includes("contracts:check") ? { status: 19 } : result;
			}),
		/pre-commit failed with exit code 19/u,
	);
	assert(!calls.some((call) => /test:tooling|dry-run/u.test(call)));
});

test("root cache context records the index before cleaning Git variables and preserves exit status", () => {
	const env = { GIT_DIR: "/repo/.git", GIT_INDEX_FILE: "/repo/alternate-index", PATH: "/bin" };
	const code = runRepositoryTests(
		{ repositoryRoot: "/repo", env, args: ["--test-name-pattern=example"] },
		(command, args, options) => {
			if (args[0] === "ls-files") {
				assert.equal(options.env.GIT_INDEX_FILE, env.GIT_INDEX_FILE);
				return { status: 0, stdout: head };
			}
			if (args.includes("--local-env-vars")) {
				return { status: 0, stdout: "GIT_DIR\nGIT_INDEX_FILE\n" };
			}
			if (args.includes("--version")) {
				return { status: 0, stdout: `${command}-version` };
			}
			assert.deepEqual(args.slice(0, -2), [
				"exec",
				"turbo",
				"run",
				...TOOLING_GROUPS.map(toolingTask),
				"--concurrency=1",
				"--summarize",
			]);
			assert.deepEqual(args.slice(-2), ["--", "--test-name-pattern=example"]);
			assert.equal(options.env.GIT_DIR, undefined);
			assert.equal(options.env.GIT_INDEX_FILE, undefined);
			assert.match(options.env.CAMPUS_TOOLING_TRACKED_CI ?? "", /^[a-f0-9]{64}$/u);
			assert.equal(options.env.CAMPUS_REPO_TEST_INDEX_TREE, undefined);
			assert.equal(JSON.parse(options.env.CAMPUS_REPO_TEST_RUNTIME ?? "").node, process.version);
			assert.equal(options.env.PATH, "/bin");
			return { status: 7 };
		},
	);
	assert.equal(code, 7);
	assert.equal(env.GIT_INDEX_FILE, "/repo/alternate-index");
});

test("Node turbo tasks respect CPU and cgroup memory limits while native tasks stay serial", () => {
	const calls: string[] = [];
	runPreCommitEvidence({ repositoryRoot: "/repo", env: {} }, stagedRunner(calls));
	const nodeCommand = calls.find((call) => call.includes("web#test:unit"));
	const nativeCommand = calls.find((call) => call.includes("model-config#native:test"));
	assert(nodeCommand?.includes(`--concurrency=${nodeTaskConcurrency()}`));
	assert.equal(
		nodeTaskConcurrency(
			() => [{}, {}, {}, {}, {}],
			() => 0,
		),
		2,
	);
	assert.equal(
		nodeTaskConcurrency(
			() => [{}, {}, {}, {}, {}, {}, {}, {}],
			() => 0,
		),
		4,
	);
	assert(nativeCommand?.includes("--concurrency=1"));
});

test("six-core runner serializes Node tasks at 2 GiB and scales within its CPU cap", () => {
	const cpus = () => [{}, {}, {}, {}, {}, {}];
	assert.equal(
		nodeTaskConcurrency(cpus, () => 2 ** 31),
		1,
	);
	assert.equal(
		nodeTaskConcurrency(cpus, () => 2 ** 32),
		2,
	);
	assert.equal(
		nodeTaskConcurrency(cpus, () => 2 ** 33),
		3,
	);
	assert.equal(
		nodeTaskConcurrency(cpus, () => 2 ** 30),
		1,
	);
});
