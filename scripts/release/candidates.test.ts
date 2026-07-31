import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { type CommandResult, type CommandRunner, planCandidates } from "./candidates.mts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function result(overrides: Partial<CommandResult> = {}): CommandResult {
	return { status: 0, stderr: "", stdout: "", ...overrides };
}

async function fixture(t: test.TestContext): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "candidate-plan-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	await writeFile(
		path.join(root, "selection.json"),
		`${JSON.stringify({ repository: "MUC-WIKI/campus-agent", sourceSha: BASE })}\n`,
	);
	return root;
}

function options(root: string) {
	return {
		full: false,
		head: HEAD,
		repositoryRoot: root,
		selectionFile: path.join(root, "selection.json"),
		validateOnly: false,
	};
}

test("maps Turbo affected package tasks to release candidates", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args, commandOptions) => {
		assert.equal(commandOptions.env.TURBO_SCM_BASE, BASE);
		assert.equal(commandOptions.env.TURBO_SCM_HEAD, HEAD);
		if (command === "pnpm") {
			return result({
				stdout: JSON.stringify({
					tasks: [
						{
							command: "tsc --project tsconfig.build.json",
							package: "agent-runtime",
							task: "build",
						},
						{ command: "vite build", package: "app-api", task: "build:worker" },
						{ command: "tsc", package: "ingestion-control", task: "build" },
						{ command: "tsc", package: "source-collector", task: "build" },
					],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({ stdout: "infra/k8s/execution-runtime/base/runtime/deployment.yaml\n" });
		}
		return result();
	};
	assert.deepEqual(await planCandidates(options(root), runner), {
		base: BASE,
		head: HEAD,
		images: ["agent-runtime"],
		kubernetes: true,
		validateOnly: false,
		validationProfiles: ["affected-node", "app-api-product-db", "infra", "release-tooling"],
		workers: ["app-api"],
	});
});

test("manual full mode selects every active candidate without running Turbo", async (t) => {
	const root = await fixture(t);
	let turboCalled = false;
	const runner: CommandRunner = (command) => {
		turboCalled ||= command === "pnpm";
		return result();
	};
	assert.deepEqual(await planCandidates({ ...options(root), full: true }, runner), {
		base: BASE,
		head: HEAD,
		images: ["agent-runtime", "app-api-schema", "execution-control", "ops-web"],
		kubernetes: true,
		validateOnly: false,
		validationProfiles: [
			"affected-node",
			"go",
			"app-api-migration",
			"app-api-product-db",
			"execution-control-postgres",
			"ops-web-postgres",
			"infra",
			"release-tooling",
		],
		workers: ["app-api"],
	});
	assert.equal(turboCalled, false);
});

test("selects Docker-only schema and Go images with their database evidence", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({
				stdout: [
					"apps/app-api/ops/db/schema.ts",
					"apps/execution-control/internal/schemamigrations/migrator.go",
				].join("\n"),
			});
		}
		return result();
	};
	assert.deepEqual(await planCandidates(options(root), runner), {
		base: BASE,
		head: HEAD,
		images: ["app-api-schema", "execution-control"],
		kubernetes: false,
		validateOnly: false,
		validationProfiles: [
			"affected-node",
			"go",
			"app-api-migration",
			"app-api-product-db",
			"execution-control-postgres",
			"release-tooling",
		],
		workers: [],
	});
});

test("selects release evidence for an artifact adapter test change", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			return result({ stdout: JSON.stringify({ tasks: [] }) });
		}
		if (args[0] === "diff") {
			return result({ stdout: "scripts/ci/check-ops-web-artifact.test.mjs\n" });
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, []);
	assert.deepEqual(plan.validationProfiles, ["release-tooling"]);
});

test("a Node lockfile change does not select the independent Go image", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (command, args) => {
		if (command === "pnpm") {
			assert(!args.includes("native:typecheck"));
			return result({
				stdout: JSON.stringify({
					tasks: [
						{ command: "<NONEXISTENT>", package: "app-api-schema", task: "build" },
						{ command: "<NONEXISTENT>", package: "execution-control", task: "build" },
					],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({ stdout: "pnpm-lock.yaml\n" });
		}
		return result();
	};
	const plan = await planCandidates(options(root), runner);
	assert.deepEqual(plan.images, ["app-api-schema"]);
	assert.deepEqual(plan.validationProfiles, [
		"affected-node",
		"app-api-migration",
		"app-api-product-db",
		"release-tooling",
	]);
});

test("rejects a release base that is not an ancestor of head", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (_command, args) =>
		args[0] === "merge-base" ? result({ status: 1 }) : result();
	await assert.rejects(planCandidates(options(root), runner), /merge-base/u);
});

test("an already selected Source revision has no automatic candidates", async (t) => {
	const root = await fixture(t);
	let turboCalled = false;
	const runner: CommandRunner = (command) => {
		turboCalled ||= command === "pnpm";
		return result();
	};
	assert.deepEqual(await planCandidates({ ...options(root), head: BASE }, runner), {
		base: BASE,
		head: BASE,
		images: [],
		kubernetes: false,
		validateOnly: false,
		validationProfiles: [],
		workers: [],
	});
	assert.equal(turboCalled, false);
});

test("an explicit PR base does not require a GitOps checkout", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = () => result();
	assert.deepEqual(
		await planCandidates(
			{
				base: BASE,
				full: false,
				head: BASE,
				repositoryRoot: root,
				validateOnly: false,
			},
			runner,
		),
		{
			base: BASE,
			head: BASE,
			images: [],
			kubernetes: false,
			validateOnly: false,
			validationProfiles: [],
			workers: [],
		},
	);
});

test("candidate planning rejects ambiguous base ownership", async (t) => {
	const root = await fixture(t);
	await assert.rejects(
		planCandidates({ ...options(root), base: BASE }),
		/exactly one base or GitOps release selection/u,
	);
});
