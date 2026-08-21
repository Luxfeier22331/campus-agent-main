import assert from "node:assert/strict";
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

test("runs affected Node tasks from the shared scope without a downloaded Turbo", () => {
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
			profiles: ["affected-node", "toolchain"],
			repositoryRoot: REPOSITORY_ROOT,
		},
		runner,
	);

	const commands = calls.map(({ command, args }) => [command, ...args]);
	assert(commands.some((command) => command.includes("--dry-run=json")));
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
	assert(commands.some((command) => command.join(" ").includes("docker buildx bake")));
	assert(!commands.some((command) => command.includes("dlx")));
	assert(calls.every((call) => call.base === BASE && call.head === HEAD));
	const bake = calls.find(
		(call) => call.command === "docker" && call.args.slice(0, 2).join(" ") === "buildx bake",
	);
	assert.equal(bake?.nodeVersion, readNodeVersion(REPOSITORY_ROOT));
});

test("runs selected native, database, and OTel profiles in order", () => {
	const calls: string[] = [];
	runCandidateEvidence(
		{
			base: BASE,
			head: HEAD,
			profiles: ["go", "ragas", "ingestion-control-postgres", "otel"],
			repositoryRoot: "/repository",
		},
		(command, args) => {
			calls.push([command, ...args].join(" "));
			return { status: 0 };
		},
	);
	assert.deepEqual(calls, [
		"pnpm exec turbo run native:format native:lint native:typecheck native:test --filter=execution-control --summarize",
		"pnpm exec turbo run typecheck test --filter=eval-langfuse --summarize",
		"pnpm exec turbo run test:eval --filter=ragas-runner --summarize",
		"pnpm exec turbo run test:database-integration --filter=ingestion-control --summarize",
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
