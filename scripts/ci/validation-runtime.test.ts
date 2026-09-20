import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runTasks } from "./evidence.mts";
import { resolveAffectedScope } from "./scope.mts";
import { BUILD_TASKS, NATIVE_TASKS, NODE_TASKS } from "./validation-profiles.mts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const rootManifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const rootTurbo = JSON.parse(readFileSync(path.join(ROOT, "turbo.json"), "utf8"));

test("real Turbo selects each Go owner, respects dependencies, and invalidates workspace inputs", (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "campus-validation-runtime-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (file: string, text: string) => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), text);
	};
	const json = (file: string, value: unknown) => write(file, JSON.stringify(value));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const commit = () => {
		git("add", ".");
		git("commit", "-qm", "fixture");
		return git("rev-parse", "HEAD");
	};
	const env = {
		...process.env,
		TURBO_TELEMETRY_DISABLED: "1",
		TURBO_CACHE: "local:rw",
		GOTOOLCHAIN: "local",
	};
	const turbo = (...args: string[]) =>
		execFileSync("pnpm", ["exec", "turbo", "run", ...args], {
			cwd: root,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	const plan = (...tasks: string[]) => JSON.parse(turbo(...tasks, "--dry-run=json"));
	symlinkSync(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
	write(".gitignore", "node_modules\n.turbo\n**/result.txt\n");
	json("package.json", {
		name: "validation-fixture",
		private: true,
		packageManager: rootManifest.packageManager,
	});
	write("pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
	write(
		"pnpm-lock.yaml",
		"lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/execution-control: {}\n  apps/model-config: {}\n  apps/web: {}\n  apps/shared: {}\n",
	);
	const tasks: Record<string, unknown> = Object.fromEntries(
		[...NODE_TASKS, ...BUILD_TASKS].map((task) => [task, { outputs: [] }]),
	);
	for (const task of NATIVE_TASKS) {
		tasks[task] = { ...rootTurbo.tasks[task], outputs: ["result.txt"] };
	}
	tasks.test = { dependsOn: ["^test"], outputs: ["result.txt"] };
	json("turbo.json", { futureFlags: { affectedUsingTaskInputs: true }, tasks });
	write("go.work", "go 1.26\nuse (\n ./apps/execution-control\n ./apps/model-config\n)\n");
	write("go.work.sum", "");
	write("flake.nix", "# fixture\n");
	write("flake.lock", "{}");
	write("nix/tools.nix", "# fixture\n");
	write("scripts/ci/turbo.mts", readFileSync(path.join(ROOT, "scripts/ci/turbo.mts"), "utf8"));
	for (const owner of ["execution-control", "model-config"]) {
		json(`apps/${owner}/package.json`, {
			name: owner,
			scripts: Object.fromEntries(NATIVE_TASKS.map((task) => [task, "node task.cjs"])),
		});
		write(`apps/${owner}/task.cjs`, 'require("node:fs").writeFileSync("result.txt", "checked");\n');
		write(`apps/${owner}/main.go`, "package fixture\n");
		write(`apps/${owner}/go.mod`, `module fixture/${owner}\ngo 1.26\n`);
		write(`apps/${owner}/go.sum`, "");
	}
	json("apps/shared/package.json", { name: "shared", scripts: { test: "node task.cjs" } });
	write("apps/shared/task.cjs", 'require("node:fs").writeFileSync("result.txt", "dependency");');
	json("apps/web/package.json", {
		name: "web",
		dependencies: { shared: "workspace:*" },
		scripts: { test: "node task.cjs" },
	});
	write(
		"apps/web/task.cjs",
		'const fs = require("node:fs"); if (!fs.existsSync("../shared/result.txt")) process.exit(9); fs.writeFileSync("result.txt", "consumer");',
	);
	git("init", "-q");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgSign", "false");
	const base = commit();
	for (const owner of ["execution-control", "model-config"]) {
		git("checkout", "-q", "--detach", base);
		write(`apps/${owner}/main.go`, "package fixture\n// source change\n");
		const head = commit();
		const selected = resolveAffectedScope({ base, head, repositoryRoot: root }).tasks;
		assert.deepEqual(
			selected
				.filter((item) => item.package === owner)
				.map((item) => item.task)
				.sort(),
			[...NATIVE_TASKS].sort(),
		);
		assert(!selected.some((item) => item.package !== owner));
	}
	git("checkout", "-q", "--detach", base);
	write("apps/model-config/.golangci.yml", 'version: "2"\n');
	let head = commit();
	assert(
		resolveAffectedScope({ base, head, repositoryRoot: root }).tasks.some(
			(item) => item.package === "model-config" && item.task === "native:lint",
		),
	);
	const target = "model-config#native:test";
	turbo(target, "--summarize");
	assert.equal(plan(target).tasks[0].cache.local, true);
	const before = plan(target).tasks[0].hash;
	write("go.work", `${readFileSync(path.join(root, "go.work"), "utf8")}// workspace changed\n`);
	head = commit();
	const changed = plan(target).tasks[0];
	assert.notEqual(changed.hash, before);
	assert.equal(changed.cache.local, false);
	for (const owner of ["execution-control", "model-config"]) {
		assert(
			resolveAffectedScope({ base, head, repositoryRoot: root }).tasks.some(
				(item) => item.package === owner && item.task === "native:test",
			),
		);
	}
	turbo(target);
	write("nix/tools.nix", "# changed toolchain\n");
	assert.equal(plan(target).tasks[0].cache.local, false);
	const execute = (
		command: string,
		args: string[],
		options: { cwd: string; env: NodeJS.ProcessEnv },
	) => {
		try {
			execFileSync(command, args, { ...options, stdio: "pipe" });
			return { status: 0 };
		} catch (error) {
			return { status: (error as { status: number }).status };
		}
	};
	runTasks(
		"affected-node",
		NODE_TASKS,
		execute,
		{ cwd: root, env },
		{ scope: [{ package: "web", task: "test" }] },
	);
	assert.equal(readFileSync(path.join(root, "apps/web/result.txt"), "utf8"), "consumer");
	write("apps/web/task.cjs", "process.exit(17);");
	assert.throws(
		() =>
			runTasks(
				"affected-node",
				NODE_TASKS,
				execute,
				{ cwd: root, env },
				{ scope: [{ package: "web", task: "test" }] },
			),
		/failed with exit code/,
	);
});

test("resolved native tasks include workspace/toolchain files and pass cache directories", () => {
	const source = execFileSync(
		"pnpm",
		[
			"exec",
			"turbo",
			"run",
			...NATIVE_TASKS,
			"--filter=execution-control",
			"--filter=model-config",
			"--dry-run=json",
		],
		{
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const plan = JSON.parse(source);
	for (const task of plan.tasks.filter(
		(task: { command: string }) => task.command !== "<NONEXISTENT>",
	)) {
		const inputs = Object.keys(task.inputs);
		assert(inputs.includes("../../go.work"), task.taskId);
		assert(inputs.includes("../../go.work.sum"), task.taskId);
		assert(inputs.includes("../../flake.lock"), task.taskId);
		assert(inputs.includes("../../nix/tools.nix"), task.taskId);
		assert(task.environmentVariables.specified.env.includes("GOTOOLCHAIN"), task.taskId);
		assert(task.environmentVariables.specified.passThroughEnv.includes("GOCACHE"), task.taskId);
	}
});

test("real Turbo keeps integration-only app dependencies out of ordinary test caches", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "campus-app-test-cache-"));
	const write = (file: string, contents: string) => {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		writeFileSync(path.join(root, file), contents);
	};
	const json = (file: string, value: unknown) => write(file, JSON.stringify(value));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
	const env = { ...process.env, TURBO_TELEMETRY_DISABLED: "1", TURBO_CACHE: "local:rw" };
	const ordinary = [
		"campus-web#test:dom:fast",
		"app-api#test:node:fast",
		"ops-web#test:node:fast",
	] as const;
	const integration = [
		"app-api#test:shared-db-integration",
		"ops-web#test:database-integration",
	] as const;
	const turbo = (...args: string[]) =>
		execFileSync("pnpm", ["exec", "turbo", "run", ...args], {
			cwd: root,
			env,
			encoding: "utf8",
			stdio: "pipe",
		});
	interface Task {
		taskId: string;
		hash: string;
		cache: { local: boolean };
		resolvedTaskDefinition: { cache: boolean };
	}
	const plan = (): Map<string, Task> => {
		const result = JSON.parse(turbo(...ordinary, ...integration, "--dry-run=json"));
		return new Map(result.tasks.map((task: Task) => [task.taskId, task]));
	};

	try {
		symlinkSync(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
		write(".gitignore", "node_modules\n.turbo\n");
		write(
			"pnpm-workspace.yaml",
			'packages:\n  - "apps/*"\n  - "jobs/*"\n  - "packages/*"\n  - "packages/domains/*"\n',
		);
		json("package.json", {
			name: "app-test-cache-fixture",
			private: true,
			packageManager: rootManifest.packageManager,
		});
		const manifests = execFileSync("git", ["ls-files", ":(glob)**/package.json"], {
			cwd: ROOT,
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.filter((file) => file !== "package.json");
		let lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
		for (const file of manifests) {
			const manifest = JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
			const workspaceDependencies = Object.fromEntries(
				Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
					([, value]) => typeof value === "string" && value.startsWith("workspace:"),
				),
			);
			const scripts = Object.fromEntries(
				[...NODE_TASKS, "test:database-integration", "test:shared-db-integration"]
					.filter((task) => manifest.scripts?.[task])
					.map((task) => [task, "node -e \"process.stdout.write('checked\\n')\""]),
			);
			json(file, { name: manifest.name, dependencies: workspaceDependencies, scripts });
			lock += `  ${path.dirname(file)}: {}\n`;
		}
		write("pnpm-lock.yaml", lock);
		json("turbo.json", {
			futureFlags: rootTurbo.futureFlags,
			tasks: Object.fromEntries(
				["source", ...NODE_TASKS, "test:database-integration", "test:shared-db-integration"].map(
					(task) => [task, rootTurbo.tasks[task]],
				),
			),
		});
		for (const app of ["app-api", "ops-web", "campus-web"]) {
			const config = JSON.parse(readFileSync(path.join(ROOT, `apps/${app}/turbo.json`), "utf8"));
			json(`apps/${app}/turbo.json`, {
				extends: ["//"],
				tasks: Object.fromEntries(
					Object.entries(config.tasks).filter(([task]) =>
						[...NODE_TASKS, "test:database-integration", "test:shared-db-integration"].includes(
							task,
						),
					),
				),
			});
		}
		const cases = [
			{
				file: "apps/campus-web/src/app/routes/dining-page.tsx",
				changed: [ordinary[0], integration[0]],
				unchanged: [ordinary[1], ordinary[2]],
			},
			{
				file: "apps/campus-web/test-support/worker.ts",
				changed: [integration[0]],
				unchanged: [ordinary[1], ordinary[2]],
			},
			{
				file: "apps/app-api/src/modules/dining/store.ts",
				changed: [ordinary[1], integration[1]],
				unchanged: [ordinary[0], ordinary[2]],
			},
			{
				file: "apps/app-api/test-support/dining.ts",
				changed: [integration[1]],
				unchanged: [ordinary[0], ordinary[2]],
			},
			{
				file: "apps/ops-web/test/setup.ts",
				changed: [ordinary[2]],
				unchanged: [ordinary[0], ordinary[1]],
			},
			{
				file: "apps/ops-web/src/server/transport-store.ts",
				changed: [ordinary[2], integration[1]],
				unchanged: [ordinary[0], ordinary[1]],
			},
			{
				file: "packages/contracts/src/contract.ts",
				changed: ordinary,
				unchanged: [],
			},
			{ file: ".dockerignore", changed: [ordinary[2]], unchanged: [ordinary[0], ordinary[1]] },
		] as const;
		for (const { file } of cases) {
			write(file, "// initial fixture\n");
		}
		git("init", "-q");
		git("config", "user.name", "Fixture");
		git("config", "user.email", "fixture@example.invalid");
		git("config", "commit.gpgSign", "false");
		git("add", ".");
		git("commit", "-qm", "fixture");
		turbo(...ordinary, "--concurrency=1");
		const before = plan();
		for (const task of ordinary) {
			assert.equal(before.get(task)?.cache.local, true, task);
		}
		for (const task of integration) {
			assert.equal(before.get(task)?.resolvedTaskDefinition.cache, false, task);
		}
		for (const { file, changed, unchanged } of cases) {
			write(file, "// changed fixture\n");
			const after = plan();
			for (const task of changed) {
				assert.notEqual(
					after.get(task)?.hash,
					before.get(task)?.hash,
					`${file} must invalidate ${task}`,
				);
				assert.equal(after.get(task)?.cache.local, false, task);
			}
			for (const task of unchanged) {
				assert.equal(
					after.get(task)?.hash,
					before.get(task)?.hash,
					`${file} must not invalidate ${task}`,
				);
				assert.equal(after.get(task)?.cache.local, true, task);
			}
			write(file, "// initial fixture\n");
		}
		const base = git("rev-parse", "HEAD");
		write("apps/app-api/test-support/dining.ts", "// changed adapter\n");
		git("add", ".");
		git("commit", "-qm", "change shared database adapter");
		const affected = JSON.parse(turbo(...integration, `--filter=...[${base}]`, "--dry-run=json"));
		assert(
			affected.tasks.some((task: Task) => task.taskId === integration[1]),
			"app-api adapter changes must select Ops database integration",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
