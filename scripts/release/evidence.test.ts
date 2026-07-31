import assert from "node:assert/strict";
import test from "node:test";

import {
	type EvidenceCommandRunner,
	parseValidationProfiles,
	runCandidateEvidence,
} from "./evidence.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

test("candidate evidence runs selected profiles with the exact revision range", () => {
	const calls: Array<{ command: string; args: string[]; base?: string; head?: string }> = [];
	const runner: EvidenceCommandRunner = (command, args, options) => {
		calls.push({
			command,
			args,
			base: options.env.TURBO_SCM_BASE,
			head: options.env.TURBO_SCM_HEAD,
		});
		return { status: 0 };
	};

	runCandidateEvidence(
		{
			base: BASE,
			head: HEAD,
			profiles: ["affected-node", "release-tooling"],
			repositoryRoot: "/repository",
		},
		runner,
	);

	assert.deepEqual(
		calls.map(({ command, args }) => [command, ...args]),
		[
			[
				"pnpm",
				"exec",
				"turbo",
				"run",
				"build",
				"test",
				"typecheck",
				"--affected",
				"--concurrency=1",
				"--summarize",
			],
			["pnpm", "ci:release"],
			["docker", "buildx", "bake", "--file", "docker-bake.hcl", "--print"],
		],
	);
	assert(calls.every((call) => call.base === BASE && call.head === HEAD));
});

test("candidate evidence rejects unsupported or duplicate profiles", () => {
	assert.throws(() => parseValidationProfiles('["unknown"]'), /Unsupported/u);
	assert.throws(() => parseValidationProfiles('["infra","infra"]'), /must be unique/u);
});

test("candidate evidence stops on the first failed profile command", () => {
	assert.throws(
		() =>
			runCandidateEvidence(
				{
					base: BASE,
					head: HEAD,
					profiles: ["infra"],
					repositoryRoot: "/repository",
				},
				() => ({ status: 2 }),
			),
		/app-api|infra failed with exit code 2/u,
	);
});
