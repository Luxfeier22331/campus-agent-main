import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { type HookCommandResult, type HookCommandRunner, installHooks } from "./install.mts";

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function cleanEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.CI;
	delete env.NODE_ENV;
	delete env.npm_config_production;
	return env;
}

function result(overrides: Partial<HookCommandResult> = {}): HookCommandResult {
	return { status: 0, stderr: "", stdout: "", ...overrides };
}

function resolvedGitPath(root: string, gitPath: string): string {
	return path.isAbsolute(gitPath) ? gitPath : path.resolve(root, gitPath);
}

test("skips lifecycle contexts that cannot own development hooks", () => {
	let calls = 0;
	const runner: HookCommandRunner = () => {
		calls += 1;
		return result({ status: 128 });
	};

	assert.deepEqual(installHooks({ env: { CI: "true" }, runner }), {
		reason: "ci",
		status: "skipped",
	});
	assert.deepEqual(installHooks({ env: { NODE_ENV: "production" }, runner }), {
		reason: "production",
		status: "skipped",
	});
	assert.equal(calls, 0);
	assert.deepEqual(installHooks({ env: {}, runner }), {
		reason: "not-git-worktree",
		status: "skipped",
	});
	assert.equal(calls, 1);
});

test("delegates standard prek installation to independent checkout hook paths", (t) => {
	const parent = mkdtempSync(path.join(os.tmpdir(), "campus-agent-hooks-test-"));
	t.after(() => rmSync(parent, { force: true, recursive: true }));
	const main = path.join(parent, "main");
	const linked = path.join(parent, "linked");
	mkdirSync(main);
	git(main, "init", "--quiet", "--initial-branch=main");
	git(main, "config", "user.email", "hooks-test@example.invalid");
	git(main, "config", "user.name", "Hooks test");
	git(main, "config", "commit.gpgSign", "false");
	writeFileSync(path.join(main, "README.md"), "fixture\n");
	git(main, "add", "README.md");
	git(main, "commit", "--quiet", "-m", "fixture");

	const installs: Array<{ args: string[]; cwd: string }> = [];
	const runner: HookCommandRunner = (command, args, options) => {
		if (command === "pnpm") {
			installs.push({ args, cwd: options.cwd });
			const hookRoot = path.join(options.cwd, ".githooks");
			mkdirSync(hookRoot, { recursive: true });
			for (const hook of ["pre-commit", "pre-push"]) {
				writeFileSync(path.join(hookRoot, hook), `${options.cwd}\n`);
			}
			return result();
		}
		const commandResult = spawnSync(command, args, {
			cwd: options.cwd,
			encoding: "utf8",
			env: options.env,
		});
		return {
			error: commandResult.error,
			status: commandResult.status,
			stderr: commandResult.stderr ?? "",
			stdout: commandResult.stdout ?? "",
		};
	};
	const env = cleanEnvironment();

	assert.equal(installHooks({ cwd: main, env, runner }).status, "installed");
	git(main, "worktree", "add", "--quiet", "-b", "feature", linked);
	assert.equal(installHooks({ cwd: linked, env, runner }).status, "installed");

	assert.equal(git(main, "config", "--get", "extensions.worktreeConfig"), "true");
	assert.equal(git(main, "config", "--worktree", "--get", "core.hooksPath"), ".githooks");
	assert.equal(git(linked, "config", "--worktree", "--get", "core.hooksPath"), ".githooks");
	const mainConfig = resolvedGitPath(main, git(main, "rev-parse", "--git-path", "config.worktree"));
	const linkedConfig = resolvedGitPath(
		linked,
		git(linked, "rev-parse", "--git-path", "config.worktree"),
	);
	assert.notEqual(mainConfig, linkedConfig);
	assert.match(readFileSync(mainConfig, "utf8"), /hooksPath = \.githooks/u);
	assert.match(readFileSync(linkedConfig, "utf8"), /hooksPath = \.githooks/u);
	assert.equal(readFileSync(path.join(main, ".githooks/pre-commit"), "utf8"), `${main}\n`);
	assert.equal(readFileSync(path.join(linked, ".githooks/pre-commit"), "utf8"), `${linked}\n`);
	assert.deepEqual(
		installs.map(({ args }) => args),
		[
			["exec", "prek", "install", "--force"],
			["exec", "prek", "install", "--force"],
		],
	);
	assert.equal(
		installs.some(({ args }) => args.includes("dev:init")),
		false,
	);

	git(main, "worktree", "remove", "--force", linked);
	assert.equal(git(main, "config", "--worktree", "--get", "core.hooksPath"), ".githooks");
	assert.equal(readFileSync(path.join(main, ".githooks/pre-push"), "utf8"), `${main}\n`);
});
