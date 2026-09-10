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
} from "./evidence.mts";

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
						profiles: ["execution-control-native"],
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
	const previousCacheRegistry = process.env.CI_IMAGE_CACHE_REGISTRY;
	process.env.CI_IMAGE_CACHE_REGISTRY = "127.0.0.1:15001/cache";
	t.after(() => {
		if (previousCacheRegistry === undefined) {
			delete process.env.CI_IMAGE_CACHE_REGISTRY;
		} else {
			process.env.CI_IMAGE_CACHE_REGISTRY = previousCacheRegistry;
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
				stdout: "M\0apps/campus-web/src/app.tsx\0M\0apps/status-web/src/index.ts\0",
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
	assert.equal(calls.filter((call) => call.command === "git" && call.args[0] === "diff").length, 1);
	const evidenceCommands = commands.filter((command) => !command.includes("--dry-run=json"));
	assert(!evidenceCommands.some((command) => command.includes("--affected")));
	assert(
		evidenceCommands.some(
			(command) =>
				command.includes("test") &&
				command.includes("--only") &&
				command.includes("--filter=agent-runtime"),
		),
	);
	assert(
		evidenceCommands.some(
			(command) => command.includes("test:worker") && command.includes("--filter=app-api"),
		),
	);
	assert(
		evidenceCommands.some(
			(command) => command.includes("test:worker") && command.includes("--filter=status-web"),
		),
	);
	assert(
		evidenceCommands.some(
			(command) => command.includes("typecheck") && command.includes("--filter=ops-web"),
		),
	);
	assert(
		commands.some(
			(command) =>
				command.includes("build") &&
				command.includes("--filter=ops-web") &&
				!command.includes("--filter=campus-web"),
		),
	);
	assert(
		commands.some(
			(command) =>
				command.includes("build:worker") &&
				command.includes("--filter=app-api") &&
				command.includes("--filter=campus-web") &&
				command.includes("--filter=status-web"),
		),
	);
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
	assert(imageEvidence.includes("--cache-registry"));
	assert(imageEvidence.includes("127.0.0.1:15001/cache"));
	assert(!commands.some((command) => command.includes("dlx")));
	assert(calls.every((call) => call.base === BASE && call.head === HEAD));
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

test("runs selected native, database, and OTel profiles in order", () => {
	const calls: string[] = [];
	runCandidateEvidence(
		{
			base: BASE,
			head: HEAD,
			profiles: ["go", "ragas", "ops-web-postgres", "otel"],
			repositoryRoot: "/repository",
		},
		(command, args) => {
			calls.push([command, ...args].join(" "));
			return { status: 0 };
		},
	);
	assert.deepEqual(calls, [
		"pnpm exec turbo run native:format --filter=execution-control --concurrency=1 --summarize",
		"pnpm exec turbo run native:lint --filter=execution-control --concurrency=1 --summarize",
		"pnpm exec turbo run native:typecheck --filter=execution-control --concurrency=1 --summarize",
		"pnpm exec turbo run native:test --filter=execution-control --concurrency=1 --summarize",
		"pnpm exec turbo run native:format --filter=model-config --concurrency=1 --summarize",
		"pnpm exec turbo run native:lint --filter=model-config --concurrency=1 --summarize",
		"pnpm exec turbo run native:typecheck --filter=model-config --concurrency=1 --summarize",
		"pnpm exec turbo run native:test --filter=model-config --concurrency=1 --summarize",
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
