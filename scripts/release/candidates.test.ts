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
						{ package: "agent-runtime", task: "build" },
						{ package: "app-api", task: "build:worker" },
						{ package: "ingestion-control", task: "build" },
						{ package: "source-collector", task: "build" },
					],
				}),
			});
		}
		if (args[0] === "diff") {
			return result({ status: 1 });
		}
		return result();
	};
	assert.deepEqual(await planCandidates(options(root), runner), {
		base: BASE,
		images: ["agent-runtime"],
		kubernetes: true,
		validateOnly: false,
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
		images: ["agent-runtime", "app-api-schema", "execution-control", "ops-web"],
		kubernetes: true,
		validateOnly: false,
		workers: ["app-api"],
	});
	assert.equal(turboCalled, false);
});

test("rejects a release base that is not an ancestor of head", async (t) => {
	const root = await fixture(t);
	const runner: CommandRunner = (_command, args) =>
		args[0] === "merge-base" ? result({ status: 1 }) : result();
	await assert.rejects(planCandidates(options(root), runner), /merge-base/u);
});
