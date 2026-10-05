import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "pg";
import { diagnoseLocalDevelopment } from "./diagnosis.ts";
import { initializeSchedule, prepareEnvironment } from "./operations.ts";
import { ensureLocalDevProfile } from "./profile.ts";
import { LOCAL_DEV_TARGETS } from "./targets.ts";

async function fixture(t: TestContext) {
	const root = mkdtempSync(resolve(tmpdir(), "local-owner-test-"));
	const previous = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = resolve(root, "state");
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		if (previous === undefined) {
			delete process.env.XDG_STATE_HOME;
		} else {
			process.env.XDG_STATE_HOME = previous;
		}
		rmSync(root, { recursive: true, force: true });
	});
	childProcess.execFileSync("git", ["init", "-q", "-b", "test"], { cwd: root });
	const profile = await ensureLocalDevProfile(root);
	return { root, profile };
}

test("every target renders cold without network, provider input or command execution", async (t) => {
	const { root, profile } = await fixture(t);
	t.mock.method(childProcess, "spawnSync", () => {
		throw new Error("Unexpected subprocess");
	});
	syncBuiltinESMExports();
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected network request");
	});
	t.mock.method(Client.prototype, "connect", () => {
		throw new Error("Unexpected database connection");
	});
	for (const target of LOCAL_DEV_TARGETS) {
		prepareEnvironment(root, profile, target);
		const result = await diagnoseLocalDevelopment(root, target, "config");
		assert.equal(result.status, "ready", JSON.stringify(result));
	}
	const path = resolve(root, "apps/ops-web/.env.local");
	writeFileSync(
		path,
		readFileSync(path, "utf8").replace(/^OPS_WEB_DATABASE_URL=.*$/mu, "OPS_WEB_DATABASE_URL="),
	);
	assert.equal((await diagnoseLocalDevelopment(root, "ops-web", "config")).status, "incomplete");
	prepareEnvironment(root, profile, "ops-web");
	writeFileSync(
		path,
		readFileSync(path, "utf8").replaceAll(profile.databaseName, "another_worktree"),
	);
	assert.equal((await diagnoseLocalDevelopment(root, "ops-web", "config")).status, "invalid");
});

test("schedule init passes the selected profile and only accepts the pipeline owner", async (t) => {
	const { root, profile } = await fixture(t);
	const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
	t.mock.method(
		childProcess,
		"spawnSync",
		(_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
			calls.push({ args, env: options.env });
			return { status: 0, stdout: "", stderr: "" };
		},
	);
	syncBuiltinESMExports();
	initializeSchedule(root, profile, "notice-pipeline-worker");
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].args, ["--filter", "notice-pipeline-worker", "schedule:init"]);
	assert.equal(calls[0].env.TEMPORAL_ADDRESS, `127.0.0.1:${profile.infraPorts.temporal}`);
	assert.equal(calls[0].env.TEMPORAL_NAMESPACE, `campus-agent-local-${profile.instanceId}`);
	assert.throws(
		() => initializeSchedule(root, profile, "notice-artifacts-worker"),
		/owns a schedule/u,
	);
	assert.equal(calls.length, 1);
});

test("legacy init data flags fail before any profile or resource initialization", () => {
	const cli = resolve(import.meta.dirname, "../cli.ts");
	for (const flag of ["--data=seed", "--replace", "--data=cluster-content"]) {
		const result = childProcess.spawnSync(
			process.execPath,
			["--import=tsx", cli, "--", "init", flag],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /dev:init only prepares environments/u);
	}
});

test("infra diagnosis checks only target services and ignores models and data", async (t) => {
	const { root, profile } = await fixture(t);
	prepareEnvironment(root, profile, "notice-classifier");
	const commands: string[][] = [];
	t.mock.method(childProcess, "spawnSync", (command: string, args: string[]) => {
		commands.push([command, ...args]);
		if (command === "psql") {
			return { status: 0, stdout: "1", stderr: "" };
		}
		assert.equal(command, "docker");
		if (args[0] === "inspect") {
			return {
				status: 0,
				stdout: JSON.stringify({ State: { Status: "running", Health: { Status: "healthy" } } }),
				stderr: "",
			};
		}
		assert.equal(args.at(-1), "postgres");
		return { status: 0, stdout: "postgres-fixture", stderr: "" };
	});
	syncBuiltinESMExports();
	t.mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected provider or object request");
	});
	const diagnosis = await diagnoseLocalDevelopment(root, "notice-classifier", "infra");
	assert.equal(diagnosis.status, "ready", JSON.stringify(diagnosis));
	assert.deepEqual(Object.keys(diagnosis.checks), ["infrastructure"]);
	assert.equal(commands.filter(([command]) => command === "psql").length, 1);
});
