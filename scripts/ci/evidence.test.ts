import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readNodeVersion } from "../toolchain/node-version.mts";
import {
	type EvidenceCommandRunner,
	parseValidationProfiles,
	runCandidateEvidence,
	runCommand,
	runVerification,
} from "./evidence.mts";

test("complete and source verification share checks without losing database coverage", () => {
	const capture = (sourceOnly: boolean) => {
		const commands: string[][] = [];
		runVerification({ sourceOnly, repositoryRoot: REPOSITORY_ROOT }, (command, args) => {
			commands.push([command, ...args]);
			return { status: 0 };
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
	assert(full.some((command) => command.includes("scripts/otel/validate-config.sh")));
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
					{ package: "execution-control", task: "native:test" },
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
	assert(commands[0]?.includes("execution-control#native:test"));
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
						{ command: "vite build", package: "campus-web", task: "build" },
						{ command: "pnpm build:test", package: "campus-web", task: "build:worker" },
						{ command: "vite build", package: "app-api", task: "build:worker" },
						{ command: "wrangler deploy", package: "status-web", task: "build:worker" },
						{ command: "vite build", package: "ops-web", task: "build" },
						{ command: "vitest", package: "agent-runtime", task: "test" },
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
	assert(taskIds.includes("agent-runtime#test"));
	assert(taskIds.includes("app-api#test:worker"));
	assert(taskIds.includes("status-web#test:worker"));
	assert(taskIds.includes("ops-web#typecheck"));
	assert(taskIds.includes("ops-web#build"));
	assert(taskIds.includes("campus-web#build:worker"));
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
								tasks: [{ command: "tsc", package: "agent-runtime", task: "build" }],
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
			profiles: ["go", "ragas", "ops-web-postgres", "otel"],
			repositoryRoot: "/repository",
		},
		(command, args) => {
			calls.push([command, ...args].join(" "));
			return { status: 0 };
		},
	);
	assert.deepEqual(calls, [
		"pnpm exec turbo run native:format native:lint native:typecheck native:test --concurrency=1 --summarize",
		"pnpm exec turbo run typecheck test --filter=eval-langfuse --summarize",
		"pnpm exec turbo run test:eval --filter=ragas-runner --concurrency=1 --summarize",
		"pnpm exec turbo run test:database-integration --filter=ops-web --summarize",
		"scripts/otel/validate-config.sh",
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
					profiles: ["infra", "otel"],
					repositoryRoot: "/repository",
				},
				() => ({ status: 2 }),
			),
		/infra failed with exit code 2/u,
	);
});
