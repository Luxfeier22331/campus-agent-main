import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readNodeVersion } from "../toolchain/node-version.mts";
import {
	type EvidenceCommandRunner,
	parseValidationProfiles,
	runCandidateEvidence,
	runCommand,
	runRepositoryChecks,
	runVerification,
	runWorkspaceCommand,
} from "./evidence.mts";

test("repository checks select locked environments, deduplicate requests and reject unknown names", () => {
	const calls: string[][] = [];
	const runner: EvidenceCommandRunner = (command, args) => {
		calls.push([command, ...args]);
		return { status: 0 };
	};
	const input = { repositoryRoot: REPOSITORY_ROOT, env: {} };
	runRepositoryChecks(input, runner);
	assert.deepEqual(calls, [
		[
			"nix",
			"develop",
			".#ci-light",
			"--command",
			"node",
			"--experimental-strip-types",
			"scripts/ci/check-canonical-order.mts",
		],
		[
			"nix",
			"develop",
			".#ci-go",
			"--command",
			"pnpm",
			"--dir",
			"packages/contracts",
			"contracts:check",
		],
		["nix", "develop", ".#ci-light", "--command", "actionlint"],
		["nix", "develop", ".#ci-light", "--command", "zizmor", "--min-severity=medium", ".github"],
	]);
	calls.length = 0;
	runRepositoryChecks({ ...input, checks: ["contracts", "contracts"] }, runner);
	assert.equal(calls.length, 1);
	calls.length = 0;
	assert.throws(
		() => runRepositoryChecks({ ...input, checks: ["contracts", "unknown"] }, runner),
		/Unsupported repository check/u,
	);
	assert.equal(calls.length, 0);
	assert.throws(
		() =>
			runRepositoryChecks({ ...input, checks: ["config"] }, (command, args) => {
				calls.push([command, ...args]);
				return { status: 29 };
			}),
		/exit code 29/u,
	);
	assert.equal(calls.length, 1);
});

test("prepared environments execute repository commands safely and propagate failures", (t) => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "repository-env-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const output: Array<{ tool: string; args: string[]; marker: string }> = [];
	for (const tool of ["node", "pnpm", "actionlint", "zizmor"]) {
		writeFileSync(
			path.join(directory, tool),
			`#!${process.execPath}
console.log(JSON.stringify({tool: ${JSON.stringify(tool)}, args: process.argv.slice(2), marker: process.env.MARKER}));
process.exit(Number(process.env.FIXTURE_EXIT || 0));
`,
			{ mode: 0o755 },
		);
	}
	// These are shell metacharacters in a filename, never shell code.
	const prepared = path.join(directory, "prepared ' $(false) environment.sh");
	writeFileSync(prepared, 'export PATH="$FIXTURE_BIN:$PATH"\nexport MARKER=prepared\n');
	const env = {
		...process.env,
		FIXTURE_BIN: directory,
		CI_NIX_GO_ENV: prepared,
		CI_NIX_LIGHT_ENV: prepared,
	};
	const runner: EvidenceCommandRunner = (command, args, options) => {
		assert.equal(command, "bash");
		const result = spawnSync(command, args, { ...options, encoding: "utf8" });
		if (result.stdout?.trim()) {
			output.push(JSON.parse(result.stdout));
		}
		return result;
	};
	runRepositoryChecks({ repositoryRoot: REPOSITORY_ROOT, env }, runner);
	assert.deepEqual(output, [
		{
			tool: "node",
			args: ["--experimental-strip-types", "scripts/ci/check-canonical-order.mts"],
			marker: "prepared",
		},
		{ tool: "pnpm", args: ["--dir", "packages/contracts", "contracts:check"], marker: "prepared" },
		{ tool: "actionlint", args: [], marker: "prepared" },
		{ tool: "zizmor", args: ["--min-severity=medium", ".github"], marker: "prepared" },
	]);
	assert.throws(
		() =>
			runRepositoryChecks(
				{ repositoryRoot: REPOSITORY_ROOT, env: { ...env, FIXTURE_EXIT: "23" } },
				runner,
			),
		/exit code 23/u,
	);
	assert.throws(
		() =>
			runRepositoryChecks(
				{
					repositoryRoot: REPOSITORY_ROOT,
					env: { ...env, CI_NIX_GO_ENV: path.join(directory, "missing.sh") },
				},
				runner,
			),
		/exit code 1/u,
	);
});

test("complete and source verification share checks without losing database coverage", () => {
	const capture = (sourceOnly: boolean) => {
		const commands: string[][] = [];
		runVerification({ sourceOnly, repositoryRoot: REPOSITORY_ROOT }, (command, args) => {
			commands.push([command, ...args]);
			return {
				status: 0,
				stdout: JSON.stringify({
					tasks: args.slice(3, -1).map((task) => ({ package: "fixture", task, command: "check" })),
				}),
			};
		});
		return commands;
	};
	const source = capture(true);
	const full = capture(false);
	assert.deepEqual(full.slice(0, source.length), source);
	assert(source.some((command) => command.includes("native:lint")));
	assert(source.some((command) => command.includes("test:eval")));
	assert(!source.some((command) => command.includes("test:database-integration")));
	assert(
		full.some(
			(command) =>
				command.includes("test:migration-integration") &&
				command.includes("test:shared-db-integration"),
		),
	);
	assert(full.some((command) => command.includes("scripts/infra/validate.sh")));
	assert(full.some((command) => command[0] === "docker" && command.includes("--print")));
});

test("an existing plan executes exact native tasks without recomputing Git or Turbo scope", () => {
	const commands: string[][] = [];
	runCandidateEvidence(
		{
			profiles: ["affected-native"],
			repositoryRoot: REPOSITORY_ROOT,
			scope: {
				base: BASE,
				head: HEAD,
				changedFiles: [],
				tasks: [
					{ package: "model-config", task: "native:lint" },
					{ package: "agent-control", task: "native:test" },
				],
			},
		},
		(command, args, options) => {
			commands.push([command, ...args]);
			assert.equal(options.env.GOTOOLCHAIN, "local");
			assert(options.env.CAMPUS_NATIVE_PLATFORM);
			return { status: 0 };
		},
	);
	assert.equal(commands.length, 1);
	assert(commands[0]?.includes("model-config#native:lint"));
	assert(commands[0]?.includes("agent-control#native:test"));
	assert(!commands[0]?.includes("--only"));
});

test("command startup errors propagate without successful profile events", () => {
	assert.throws(
		() =>
			runCandidateEvidence({ profiles: ["go"], repositoryRoot: REPOSITORY_ROOT }, () => ({
				status: null,
				error: new Error("tool unavailable"),
			})),
		/tool unavailable/,
	);
});

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");

test("records completed commands before a failure without running later commands", () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "ci-evidence-"));
	const file = path.join(directory, "events.jsonl");
	let calls = 0;
	try {
		assert.throws(
			() =>
				runCandidateEvidence(
					{
						base: BASE,
						head: HEAD,
						profiles: ["ragas", "infra"],
						repositoryRoot: REPOSITORY_ROOT,
						eventFile: file,
					},
					() => ({ status: ++calls === 2 ? 17 : 0 }),
				),
			/exit code 17/u,
		);
		assert.equal(calls, 2);
		const events = readFileSync(file, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const commands = events.filter(
			(event) => event.kind === "command" && event.status !== "running",
		);
		assert.deepEqual(
			commands.map((event) => [event.status, event.exitCode]),
			[
				["success", 0],
				["failure", 17],
			],
		);
		assert.ok(
			commands.every((event) => event.durationMs >= 0 && event.startedAt && event.finishedAt),
		);
		assert.equal(events.at(-1).kind, "profile");
		assert.equal(events.at(-1).status, "failure");
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("captures structured command output larger than the Node default buffer", () => {
	const outputBytes = 2 * 1024 * 1024;
	const result = runCommand(
		process.execPath,
		["-e", `process.stdout.write("x".repeat(${outputBytes}))`, "--", "--dry-run=json"],
		{ cwd: process.cwd(), env: process.env },
	);
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0);
	assert.equal(result.stdout?.length, outputBytes);
});

test("runs affected Node tasks from the shared scope without a downloaded Turbo", (t) => {
	const previousCacheRegistry = process.env.CI_IMAGE_CACHE_IMPORT_REGISTRIES;
	process.env.CI_IMAGE_CACHE_IMPORT_REGISTRIES = '["127.0.0.1:15001/cache"]';
	t.after(() => {
		if (previousCacheRegistry === undefined) {
			delete process.env.CI_IMAGE_CACHE_IMPORT_REGISTRIES;
		} else {
			process.env.CI_IMAGE_CACHE_IMPORT_REGISTRIES = previousCacheRegistry;
		}
	});
	const calls: Array<{
		command: string;
		args: string[];
		base?: string;
		head?: string;
		nodeVersion?: string;
	}> = [];
	const runner: EvidenceCommandRunner = (command, args, options) => {
		calls.push({
			command,
			args,
			base: options.env.TURBO_SCM_BASE,
			head: options.env.TURBO_SCM_HEAD,
			nodeVersion: options.env.NODE_VERSION,
		});
		if (command === "pnpm" && args.includes("--dry-run=json")) {
			return {
				status: 0,
				stdout: JSON.stringify({
					tasks: [
						{ command: "pnpm build:fixture", package: "campus-web", task: "build:check" },
						{ command: "vite build", package: "app-api", task: "build:check" },
						{ command: "wrangler deploy", package: "status-web", task: "build:check" },
						{ command: "vite build", package: "ops-web", task: "build:check" },
						{ command: "tsc", package: "agent-runtime", task: "build:check" },
						{ command: "vitest", package: "agent-runtime", task: "test:unit" },
						{ command: "vitest", package: "app-api", task: "test:worker" },
						{ command: "vitest", package: "status-web", task: "test:worker" },
						{ command: "tsc", package: "ops-web", task: "typecheck" },
					],
				}),
			};
		}
		if (command === "git" && args[0] === "diff") {
			return {
				status: 0,
				stdout:
					"M\0apps/campus-web/src/app.tsx\0M\0apps/status-web/src/index.ts\0M\0apps/ops-web/Dockerfile\0",
			};
		}
		return { status: 0 };
	};

	runCandidateEvidence(
		{
			base: BASE,
			head: HEAD,
			profiles: ["affected-node", "container-build", "image-build"],
			repository: "MUC-WIKI/campus-agent",
			repositoryRoot: REPOSITORY_ROOT,
			summaryFile: "/tmp/campus-agent-summary.md",
		},
		runner,
	);

	const commands = calls.map(({ command, args }) => [command, ...args]);
	assert(commands.some((command) => command.includes("--dry-run=json")));
	assert.equal(calls.filter((call) => call.command === "git" && call.args[0] === "diff").length, 2);
	const evidenceCommands = commands.filter((command) => !command.includes("--dry-run=json"));
	assert(!evidenceCommands.some((command) => command.includes("--affected")));
	const taskIds = evidenceCommands.flat().filter((arg) => arg.includes("#"));
	assert(taskIds.includes("agent-runtime#test:unit"));
	assert(taskIds.includes("app-api#test:worker"));
	assert(taskIds.includes("status-web#test:worker"));
	assert(!taskIds.includes("ops-web#typecheck"));
	assert(!taskIds.includes("ops-web#build:check"));
	assert(taskIds.includes("agent-runtime#build:check"));
	assert(taskIds.includes("campus-web#build:check"));
	assert(!taskIds.includes("campus-web#build"));
	assert(!evidenceCommands.flat().includes("--only"));
	assert(
		commands.some((command) =>
			command.join(" ").includes("docker buildx bake --file docker-bake.hcl --print"),
		),
	);
	const imageEvidence = commands.find(
		(command) => command[0] === "node" && command.includes("scripts/release/images.mts"),
	);
	assert(imageEvidence);
	assert(imageEvidence.includes("--mode"));
	assert(imageEvidence.includes("build-only"));
	assert(imageEvidence.includes("--images"));
	assert(imageEvidence.includes('["ops-web"]'));
	assert(imageEvidence.includes("--repository"));
	assert(imageEvidence.includes("MUC-WIKI/campus-agent"));
	assert(imageEvidence.includes("--source-sha"));
	assert(imageEvidence.includes(HEAD));
	assert(imageEvidence.includes("--summary"));
	assert(imageEvidence.includes("/tmp/campus-agent-summary.md"));
	assert(imageEvidence.includes("--cache-import-registries"));
	assert(imageEvidence.includes('["127.0.0.1:15001/cache"]'));
	assert(!commands.some((command) => command.includes("dlx")));
	assert(
		calls
			.filter((call) => call.command !== "git")
			.every((call) => call.base === BASE && call.head === HEAD),
	);
	const bake = calls.find(
		(call) => call.command === "docker" && call.args.slice(0, 2).join(" ") === "buildx bake",
	);
	assert.equal(bake?.nodeVersion, readNodeVersion(REPOSITORY_ROOT));
});

test("affected generator tests use the Go environment once and preserve failure propagation", () => {
	for (const generatorsAffected of [false, true]) {
		const calls: string[][] = [];
		const input = {
			profiles: ["affected-node"] as const,
			repositoryRoot: REPOSITORY_ROOT,
			scope: {
				base: BASE,
				head: HEAD,
				changedFiles: [],
				tasks: [
					{ package: "campus-contracts", task: "test:unit" },
					...(generatorsAffected ? [{ package: "campus-contracts", task: "test:generators" }] : []),
				],
			},
		};
		runCandidateEvidence({ ...input, profiles: [...input.profiles] }, (command, args) => {
			calls.push([command, ...args]);
			return { status: 0 };
		});
		const generatorCalls = calls.filter((call) =>
			call.includes("campus-contracts#test:generators"),
		);
		assert.equal(generatorCalls.length, generatorsAffected ? 1 : 0);
		assert.equal(calls.filter((call) => call[0] === "nix").length, generatorCalls.length);
		const unitCalls = calls.filter((call) => call.includes("campus-contracts#test:unit"));
		assert.equal(unitCalls.length, 1);
		assert.equal(unitCalls[0][0], "node");
		if (generatorsAffected) {
			assert.deepEqual(generatorCalls[0].slice(0, 5), [
				"nix",
				"develop",
				".#ci-go",
				"--command",
				"node",
			]);
			calls.length = 0;
			assert.throws(
				() =>
					runCandidateEvidence({ ...input, profiles: [...input.profiles] }, (command, args) => {
						calls.push([command, ...args]);
						return { status: 17 };
					}),
				/exit code 17/u,
			);
			assert.equal(calls.length, 1);
			assert(calls[0].includes("campus-contracts#test:generators"));
		} else {
			assert.equal(calls.length, 1);
			assert.equal(calls[0][0], "node");
			assert(calls[0].includes("campus-contracts#test:unit"));
		}
	}
});

test("requires an explicit repository for image evidence", () => {
	assert.throws(
		() =>
			runCandidateEvidence(
				{
					base: BASE,
					head: HEAD,
					profiles: ["image-build"],
					repositoryRoot: REPOSITORY_ROOT,
				},
				(command, args) => {
					if (command === "git" && args[0] === "diff") {
						return {
							status: 0,
							stdout: "M\0apps/agent-runtime/src/index.ts\0",
						};
					}
					if (command === "pnpm") {
						return {
							status: 0,
							stdout: JSON.stringify({
								tasks: [{ command: "tsc", package: "agent-runtime", task: "build:check" }],
							}),
						};
					}
					return { status: 0 };
				},
			),
		/Image build evidence requires --repository/u,
	);
});

test("runs fixed profiles without consulting Git", () => {
	const calls: string[] = [];
	runCandidateEvidence(
		{
			profiles: ["go", "ragas", "ops-web-postgres", "infra"],
			repositoryRoot: "/repository",
		},
		(command, args) => {
			calls.push([command, ...args].join(" "));
			return {
				status: 0,
				stdout: JSON.stringify({
					tasks: args.slice(3, -1).map((task) => ({ package: "fixture", task, command: "check" })),
				}),
			};
		},
	);
	assert.deepEqual(calls, [
		"pnpm exec turbo run native:format native:lint native:vet native:test --dry-run=json",
		"node --experimental-strip-types scripts/ci/turbo.mts fixture#native:format fixture#native:lint fixture#native:test fixture#native:vet --concurrency=1 --summarize",
		"node --experimental-strip-types scripts/ci/turbo.mts typecheck test --filter=eval-langfuse --summarize",
		"node --experimental-strip-types scripts/ci/turbo.mts test:eval --filter=ragas-runner --concurrency=1 --summarize",
		"node --experimental-strip-types scripts/ci/turbo.mts test:database-integration --filter=ops-web --summarize",
		"scripts/infra/validate.sh",
	]);
});

test("rejects malformed, unsupported, and duplicate profile input", () => {
	assert.throws(() => parseValidationProfiles("{}"), /JSON array/u);
	assert.throws(() => parseValidationProfiles('["unknown"]'), /Unsupported/u);
	assert.throws(() => parseValidationProfiles('["infra","infra"]'), /must be unique/u);
});

test("stops on the first failed profile command", () => {
	assert.throws(
		() =>
			runCandidateEvidence(
				{
					base: BASE,
					head: HEAD,
					profiles: ["infra", "ragas"],
					repositoryRoot: "/repository",
				},
				() => ({ status: 2 }),
			),
		/infra failed with exit code 2/u,
	);
});

test("workspace tests select each leaf once and preserve resource/tooling context", () => {
	const calls: string[][] = [];
	const tasks = [
		{ package: "web", task: "test", command: "<NONEXISTENT>", dependencies: ["web#test:unit"] },
		{ package: "web", task: "test:unit", command: "vitest" },
		{ package: "web", task: "test:worker", command: "vitest" },
		{ package: "web", task: "source", command: "<NONEXISTENT>" },
		{ package: "agent-control", task: "native:test", command: "go test" },
		{ package: "ragas-runner", task: "test:eval", command: "uv run" },
		{ package: "@campus-agent/tooling", task: "test:ci", command: "tsx" },
	];
	runWorkspaceCommand(
		"test",
		["--filter=web", "--affected"],
		REPOSITORY_ROOT,
		(command, args, options) => {
			calls.push([command, ...args]);
			if (args.includes("--dry-run=json")) {
				assert(args.includes("--filter=web"));
				assert(args.includes("--affected"));
				assert(!args.includes("--filter=web..."));
				return { status: 0, stdout: JSON.stringify({ tasks }) };
			}
			if (args.includes("@campus-agent/tooling#test:ci")) {
				assert(options.env.CAMPUS_REPO_TEST_RUNTIME);
				assert(options.env.CAMPUS_TOOLING_TRACKED_CI);
				assert(args.includes("--concurrency=1"));
			}
			if (args.includes("agent-control#native:test")) {
				assert(args.includes("--concurrency=1"));
				assert.equal(options.env.GOTOOLCHAIN, "local");
			}
			return { status: 0, stdout: "" };
		},
	);
	const executed = calls.flat().filter((arg) => arg.includes("#") && !arg.startsWith(".#"));
	assert.deepEqual(executed.sort(), [
		"@campus-agent/tooling#test:ci",
		"agent-control#native:test",
		"ragas-runner#test:eval",
		"web#test:unit",
		"web#test:worker",
	]);
});

test("filtered check keeps repository checks and verify profiles do not recurse", () => {
	const calls: string[][] = [];
	const runner: EvidenceCommandRunner = (command, args) => {
		calls.push([command, ...args]);
		return {
			status: 0,
			stdout: JSON.stringify({ tasks: [{ package: "web", task: "typecheck", command: "tsc" }] }),
		};
	};
	runWorkspaceCommand("check", ["--filter", "web"], REPOSITORY_ROOT, runner);
	assert(calls.some((args) => args.join(" ") === "pnpm lint"));
	assert(calls.some((args) => args.join(" ") === "pnpm docs:check"));
	assert(calls.some((args) => args.join(" ") === "pnpm test:tooling"));
	assert(calls.some((args) => args.includes("contracts:check")));
	assert(calls.some((args) => args.includes("actionlint")));
	assert(!calls.some((args) => args.join(" ") === "pnpm check"));
	calls.length = 0;
	runWorkspaceCommand(
		"verify",
		["--profile=infra", "--profile=container-build"],
		REPOSITORY_ROOT,
		runner,
	);
	assert.deepEqual(
		calls.map((args) => args[0]),
		["scripts/infra/validate.sh", "docker"],
	);
	assert.throws(
		() => runWorkspaceCommand("verify", ["--source"], REPOSITORY_ROOT, runner),
		/Unsupported workspace option/u,
	);
	assert.throws(
		() => runWorkspaceCommand("test", ["--run"], REPOSITORY_ROOT, runner),
		/child leaf script/u,
	);
});

test("workspace failures stop later task families", () => {
	const calls: string[][] = [];
	assert.throws(
		() =>
			runWorkspaceCommand("test", [], REPOSITORY_ROOT, (command, args) => {
				calls.push([command, ...args]);
				if (args.includes("--dry-run=json")) {
					return {
						status: 0,
						stdout: JSON.stringify({
							tasks: [
								{ package: "web", task: "test:unit", command: "vitest" },
								{ package: "agent-control", task: "native:test", command: "go test" },
							],
						}),
					};
				}
				return { status: args.includes("web#test:unit") ? 23 : 0, stdout: "" };
			}),
		/exit code 23/u,
	);
	assert(!calls.some((args) => args.includes("agent-control#native:test")));
});

test("the full Campus E2E flow builds once, marks suites prebuilt, and stops on build failure", () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "campus-e2e-command-"));
	try {
		const bin = path.join(directory, "pnpm");
		writeFileSync(
			bin,
			`#!${process.execPath}\nconst fs = require('node:fs'); fs.appendFileSync(process.env.CALLS, JSON.stringify({ args: process.argv.slice(2), prebuilt: process.env.CAMPUS_WEB_E2E_PREBUILT }) + '\\n'); if (process.env.FAIL_BUILD === '1' && process.argv.includes('build:fixture')) process.exit(17);\n`,
			{ mode: 0o755 },
		);
		const log = path.join(directory, "calls.jsonl");
		const execute = (fail: boolean) =>
			spawnSync(
				"bash",
				[
					path.join(REPOSITORY_ROOT, "apps/campus-web/scripts/test-e2e-full.sh"),
					"file with spaces",
				],
				{
					cwd: directory,
					env: {
						...process.env,
						PATH: `${directory}:${process.env.PATH}`,
						CALLS: log,
						FAIL_BUILD: fail ? "1" : "0",
					},
					encoding: "utf8",
				},
			);
		const read = () =>
			readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
		assert.equal(execute(false).status, 0);
		assert.deepEqual(read(), [
			{ args: ["run", "build:fixture"] },
			{ args: ["run", "test:e2e"], prebuilt: "1" },
			{ args: ["run", "test:e2e:worker"], prebuilt: "1" },
			{ args: ["run", "test:e2e:ui-baseline", "file with spaces"], prebuilt: "1" },
		]);
		writeFileSync(log, "");
		assert.equal(execute(true).status, 17);
		assert.deepEqual(read(), [{ args: ["run", "build:fixture"] }]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
