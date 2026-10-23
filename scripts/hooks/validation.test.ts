import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { installHooks } from "./install.mts";

const source = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
const config = parse(readFileSync(path.join(source, ".config/.pre-commit-config.yaml"), "utf8"));
const rootTask = JSON.parse(readFileSync(path.join(source, "scripts/turbo.json"), "utf8")).tasks[
	"test:ci"
];

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "campus-commit-validation-"));
	const write = (file: string, value: string | object) => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
	};
	const env: NodeJS.ProcessEnv = {
		...process.env,
		TURBO_CACHE: "local:rw",
		TURBO_TELEMETRY_DISABLED: "1",
		PREK_HOME: path.join(root, ".prek"),
		PATH: `${root}/bin:${process.env.PATH}`,
	};
	for (const key of [
		"CI",
		"NODE_ENV",
		"npm_config_production",
		"TURBO_SCM_BASE",
		"TURBO_SCM_HEAD",
	]) {
		delete env[key as keyof typeof env];
	}
	const run = (command: string, args: string[], expected = 0) => {
		const r = spawnSync(command, args, { cwd: root, env, encoding: "utf8", timeout: 90000 });
		if (r.error) {
			throw r.error;
		}
		if (expected === 0 ? r.status !== 0 : r.status === 0) {
			throw new Error(
				`${command} ${args.join(" ")}: expected ${expected === 0 ? "success" : "failure"}, got ${r.status}\n${r.stdout}\n${r.stderr}`,
			);
		}
		return `${r.stdout}${r.stderr}`;
	};
	const git = (...args: string[]) => run("git", args).trim();
	const counts = () =>
		existsSync(path.join(root, "runs.log"))
			? readFileSync(path.join(root, "runs.log"), "utf8").trim().split("\n")
			: [];
	symlinkSync(path.join(source, "node_modules"), path.join(root, "node_modules"), "dir");
	write(".gitignore", "node_modules\n.turbo\n.prek\n.githooks\nruns.log\nbin\n");
	write("package.json", {
		name: "validation-fixture",
		private: true,
		packageManager: manifest.packageManager,
		scripts: {
			"test:tooling": `node --experimental-strip-types ${source}/scripts/ci/repository-test.mts`,
		},
	});
	write("pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "scripts"\n');
	write(
		"pnpm-lock.yaml",
		"lockfileVersion: '9.0'\nimporters:\n  .: {}\n  scripts: {}\n  apps/shared: {}\n  apps/web:\n    dependencies:\n      shared:\n        specifier: 'workspace:*'\n        version: link:../shared\n  apps/native: {}\n",
	);
	write("turbo.json", {
		futureFlags: { affectedUsingTaskInputs: true },
		tasks: {
			...Object.fromEntries(
				["ci", "dev", "docs", "hooks", "infra", "notices", "release"].map((group) => [
					`@campus-agent/tooling#test:${group}`,
					{
						...rootTask,
						inputs: [
							"$TURBO_ROOT$/root*",
							"$TURBO_ROOT$/apps/**",
							"$TURBO_ROOT$/.github/**",
							"$TURBO_ROOT$/flake.lock",
						],
					},
				]),
			),
			typecheck: { outputs: [] },
			source: { dependsOn: ["^source"], outputs: [] },
			"test:generators": { outputs: [] },
			"test:worker": { outputs: [] },
			"test:node:fast": { outputs: [] },
			"test:node:isolated": { outputs: [] },
			"test:dom:fast": { outputs: [] },
			"test:dom:isolated": { outputs: [] },
			"native:format": { outputs: [] },
			"native:lint": { outputs: [] },
			"native:vet": { outputs: [] },
			"test:unit": {
				dependsOn: ["^source"],
				inputs: ["$TURBO_DEFAULT$", "!README.md"],
				outputs: [],
			},
			"native:test": { inputs: ["$TURBO_DEFAULT$"], outputs: [] },
		},
	});
	write("scripts/package.json", {
		name: "@campus-agent/tooling",
		scripts: { "test:ci": "cd .. && node root-check.cjs" },
	});
	write("scripts/ci/turbo.mts", readFileSync(path.join(source, "scripts/ci/turbo.mts"), "utf8"));
	for (const app of ["shared", "web", "native"]) {
		write(`apps/${app}/package.json`, {
			name: app,
			...(app === "web" ? { dependencies: { shared: "workspace:*" } } : {}),
			scripts: { [app === "native" ? "native:test" : "test:unit"]: "node ../../package-check.cjs" },
		});
		write(`apps/${app}/src.txt`, "good\n");
	}
	write(
		"root-check.cjs",
		'const fs = require("node:fs"); fs.appendFileSync("runs.log", "root\\n"); if (fs.readFileSync("root.txt", "utf8").includes("bad")) process.exit(19);',
	);
	write(
		"package-check.cjs",
		'const fs = require("node:fs"); const path = require("node:path"); fs.appendFileSync("../../runs.log", path.basename(process.cwd()) + "\\n"); for (const f of fs.readdirSync(".")) if(f.endsWith(".txt") && fs.readFileSync(f,"utf8").includes("bad")) process.exit(17);',
	);
	write(
		"static.cjs",
		'if (require("node:fs").readFileSync("static.txt", "utf8").includes("bad")) process.exit(21);',
	);
	write("root.txt", "good\n");
	write("static.txt", "good\n");
	write(".github/workflows/pr.yml", "name: fixture\n");
	write("bin/nix", '#!/bin/sh\n[ "$1" = develop ] || exit 23\nshift 3\nexec "$@"\n');
	run("chmod", ["+x", "bin/nix"]);
	const hook = structuredClone(
		config.repos
			.flatMap((r: { hooks: { id: string }[] }) => r.hooks)
			.find((h: { id: string }) => h.id === "affected-pre-commit"),
	);
	assert(hook);
	hook.entry = `node --experimental-strip-types ${source}/scripts/ci/pre-commit.mts`;
	const branchGuard = config.repos
		.find((r: { repo: string }) => r.repo === "builtin")
		?.hooks.find((h: { id: string }) => h.id === "no-commit-to-branch");
	assert(branchGuard);
	write(
		".config/.pre-commit-config.yaml",
		stringify({
			minimum_prek_version: config.minimum_prek_version,
			default_install_hook_types: config.default_install_hook_types,
			fail_fast: config.fail_fast,
			repos: [
				{ repo: "builtin", hooks: [branchGuard] },
				{
					repo: "local",
					hooks: [
						{
							id: "static",
							name: "static",
							entry: "node static.cjs",
							language: "system",
							pass_filenames: false,
							always_run: true,
							stages: ["pre-commit"],
						},
						hook,
					],
				},
			],
		}),
	);
	git("init", "-q", "--initial-branch=main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgSign", "false");
	git("add", ".");
	git("commit", "-qm", "fixture");
	return { root, write, run, git, counts, env };
}

test("root test cache hits before/after commit, invalidates real inputs/index, and never caches failures", {
	timeout: 90000,
}, () => {
	const f = fixture();
	try {
		const check = (expected = 0) => f.run("pnpm", ["test:tooling"], expected);
		check();
		assert.equal(f.counts().length, 1);
		assert.match(check(), /1 cached, 1 total/u);
		assert.equal(f.counts().length, 1);
		f.git("commit", "--amend", "-qm", "changed message");
		check();
		assert.equal(f.counts().length, 1);
		for (const file of ["apps/web/src.txt", ".github/workflows/pr.yml", "flake.lock"]) {
			f.write(file, "changed\n");
			check();
		}
		assert.equal(f.counts().length, 4);
		// Same filesystem content, newly tracked path: only the index context changes.
		f.git("add", "flake.lock");
		check();
		assert.equal(f.counts().length, 5);
		f.git("commit", "-qm", "track file");
		check();
		assert.equal(f.counts().length, 5);
		f.write("root.txt", "bad\n");
		check(1);
		check(1);
		assert.equal(f.counts().length, 7);
		f.write("root.txt", "good\n");
		check();
		assert.equal(f.counts().length, 7);
		// Environment-only changes must also invalidate the root task's result.
		const baseline = f.run("pnpm", [
			"exec",
			"turbo",
			"run",
			"@campus-agent/tooling#test:ci",
			"--dry-run=json",
		]);
		const baseHash = JSON.parse(
			baseline.slice(baseline.indexOf("{"), baseline.lastIndexOf("}") + 1),
		).tasks[0].hash;
		f.env.CAMPUS_REPO_TEST_RUNTIME = "different-toolchain";
		const changed = f.run("pnpm", [
			"exec",
			"turbo",
			"run",
			"@campus-agent/tooling#test:ci",
			"--dry-run=json",
		]);
		assert.notEqual(
			JSON.parse(changed.slice(changed.indexOf("{"), changed.lastIndexOf("}") + 1)).tasks[0].hash,
			baseHash,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("installed hook refuses main commits, validates staged content and dependencies, restores partial edits, and retires push checks", {
	timeout: 120000,
}, () => {
	const f = fixture();
	try {
		// Install an old managed pre-push shim, then exercise the actual upgrade twice.
		f.git("config", "extensions.worktreeConfig", "true");
		f.git("config", "--worktree", "core.hooksPath", ".githooks");
		f.run("pnpm", ["exec", "prek", "install", "--hook-type", "pre-push", "--force"]);
		assert(existsSync(path.join(f.root, ".githooks/pre-push")));
		installHooks({ cwd: f.root, env: f.env });
		installHooks({ cwd: f.root, env: f.env });
		assert(!existsSync(path.join(f.root, ".githooks/pre-push")));
		f.write("root.txt", "good main edit\n");
		f.git("add", "root.txt");
		assert.match(
			f.run("git", ["commit", "-qm", "main commit"], 1),
			/no-commit-to-branch|Don't commit to branch/iu,
		);
		assert.equal(f.counts().length, 0);
		f.git("restore", "--staged", "--worktree", "root.txt");
		f.git("switch", "-qc", "feature");
		f.write("static.txt", "bad\n");
		f.git("add", "static.txt");
		f.run("git", ["commit", "-qm", "static fails"], 1);
		assert.equal(f.counts().length, 0);
		f.git("restore", "--staged", "--worktree", "static.txt");
		f.write("root.txt", "bad\n");
		f.git("add", "root.txt");
		f.run("git", ["commit", "-qm", "root fails"], 1);
		assert.deepEqual(f.counts(), ["root"]);
		f.git("restore", "--staged", "--worktree", "root.txt");
		// A good unstaged edit must not hide bad staged source.
		f.write("apps/web/src.txt", "bad\n");
		f.git("add", "apps/web/src.txt");
		f.write("apps/web/src.txt", "good unstaged fix\n");
		const before = f.git("rev-parse", "HEAD");
		f.run("git", ["commit", "-qm", "staged source fails"], 1);
		assert.equal(f.git("rev-parse", "HEAD"), before);
		assert.equal(
			readFileSync(path.join(f.root, "apps/web/src.txt"), "utf8"),
			"good unstaged fix\n",
		);
		assert.equal(f.git("show", ":apps/web/src.txt"), "bad");
		f.git("add", "apps/web/src.txt");
		f.git("commit", "-qm", "fixed source");
		// Source dependency changes select both owner and consumer.
		const start = f.counts().length;
		f.write("apps/shared/src.txt", "good changed\n");
		f.git("add", "apps/shared/src.txt");
		f.git("commit", "-qm", "shared source");
		assert(f.counts().slice(start).includes("shared"));
		assert(f.counts().slice(start).includes("web"));
		f.write("apps/web/added.txt", "bad\n");
		f.git("add", "apps/web/added.txt");
		f.run("git", ["commit", "-qm", "added source fails"], 1);
		f.write("apps/web/added.txt", "good\n");
		f.git("add", "apps/web/added.txt");
		f.git("commit", "-qm", "added source");
		f.git("mv", "apps/web/added.txt", "apps/web/renamed.txt");
		f.git("commit", "-qm", "renamed source");
		f.git("rm", "-q", "apps/web/renamed.txt");
		f.git("commit", "-qm", "deleted source");
		f.write("apps/native/src.txt", "bad\n");
		f.git("add", "apps/native/src.txt");
		f.run("git", ["commit", "-qm", "native failure"], 1);
		f.write("apps/native/src.txt", "good fixed\n");
		f.git("add", "apps/native/src.txt");
		f.git("commit", "-qm", "native fix");
		const count = f.counts().length;
		f.run("pnpm", [
			"exec",
			"prek",
			"run",
			"--config",
			".config/.pre-commit-config.yaml",
			"--all-files",
			"--stage",
			"pre-commit",
			"--no-group",
			"validation",
		]);
		assert.equal(f.counts().length, count);
		const bare = path.join(f.root, "remote.git");
		f.run("git", ["init", "--bare", "-q", bare]);
		f.git("push", bare, "HEAD:refs/heads/main");
		assert.equal(f.counts().length, count);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
