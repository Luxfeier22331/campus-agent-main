import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
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
import { parseTurboTasks } from "./scope.mts";
import { nodeRuntimeEnvironment } from "./turbo.mts";
import { BUILD_TASKS, NATIVE_TASKS, NODE_TASKS } from "./validation-profiles.mts";

const root = path.resolve(import.meta.dirname, "../..");

test("real workspace inputs invalidate consumers without invalidating unrelated evidence", {
	timeout: 120_000,
}, () => {
	const fixture = mkdtempSync(path.join(os.tmpdir(), "campus-cache-boundaries-"));
	const env = {
		...nodeRuntimeEnvironment(),
		TURBO_CACHE: "local:rw",
		TURBO_TELEMETRY_DISABLED: "1",
	};
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: fixture, env, encoding: "utf8", stdio: "pipe" });
	const write = (file: string, text: string) => {
		mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
		writeFileSync(path.join(fixture, file), text);
	};
	const tasks = [
		...NODE_TASKS,
		...BUILD_TASKS,
		...NATIVE_TASKS,
		"@campus-agent/tooling#test:hooks",
		"@campus-agent/tooling#test:docs",
	];
	const dry = (affected = false) => {
		const stdout = execFileSync(
			"pnpm",
			["exec", "turbo", "run", ...tasks, ...(affected ? ["--affected"] : []), "--dry-run=json"],
			{
				cwd: fixture,
				env: { ...env, ...(affected ? { TURBO_SCM_BASE: "HEAD", TURBO_SCM_HEAD: undefined } : {}) },
				encoding: "utf8",
				maxBuffer: 32 * 1024 * 1024,
			},
		);
		return JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
			globalCacheInputs: { hashOfInternalDependencies: string };
			tasks: {
				taskId: string;
				hash: string;
				dependencies: string[];
				command: string;
				package: string;
				task: string;
				inputs: Record<string, string>;
			}[];
		};
	};
	try {
		// Preserve the actual root dependencies, workspace declarations and lockfile. Omitting root
		// dependencies in a synthetic manifest hid the global-hash regression in earlier tests.
		const files = execFileSync(
			"git",
			["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{ cwd: root, encoding: "utf8" },
		)
			.split("\0")
			.filter(Boolean);
		for (const file of new Set(files)) {
			if (!existsSync(path.join(root, file))) {
				continue;
			}
			mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
			copyFileSync(path.join(root, file), path.join(fixture, file));
		}
		symlinkSync(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
		git("init", "-q");
		git("config", "user.name", "Cache boundary test");
		git("config", "user.email", "cache@example.invalid");
		git("config", "core.hooksPath", ".no-hooks");
		git("add", ".");
		git("-c", "commit.gpgSign=false", "commit", "-qm", "baseline");
		const baseline = dry();
		assert.equal(baseline.globalCacheInputs.hashOfInternalDependencies, "");
		const hashes = (run: ReturnType<typeof dry>) =>
			new Map(run.tasks.map((t) => [t.taskId, t.hash]));
		const before = hashes(baseline);
		const check = (file: string, changed: string[], unchanged: string[]) => {
			const previous = readFileSync(path.join(fixture, file), "utf8");
			write(file, `${previous}\n`);
			try {
				const after = hashes(dry());
				for (const id of changed) {
					assert(before.has(id), `missing baseline task ${id}`);
					assert.notEqual(after.get(id), before.get(id), `${file} must invalidate ${id}`);
				}
				for (const id of unchanged) {
					assert(before.has(id), `missing baseline task ${id}`);
					assert.equal(after.get(id), before.get(id), `${file} must not invalidate ${id}`);
				}
				const selected = new Set(
					parseTurboTasks(JSON.stringify(dry(true))).map((t) => `${t.package}#${t.task}`),
				);
				for (const id of changed) {
					assert(selected.has(id), `affected selection omitted ${id} for ${file}`);
				}
			} finally {
				write(file, previous);
			}
		};
		check(
			"apps/campus-web/docs-source/collections.yaml",
			["campus-web#test:node:fast", "campus-web#build:worker"],
			["app-api#build:worker", "ops-web#build", "campus-docs-index-publisher#build"],
		);
		check(
			"packages/contracts/fixtures/citation-markers.v1.json",
			["execution-control#native:test", "campus-web#test:dom:fast"],
			[
				"ingestion-contracts#test",
				"@campus-agent/embedding-runtime#test",
				"model-config#native:test",
				"ops-web#test:dom:fast",
				"campus-web#test:node:fast",
				"campus-web#build:worker",
			],
		);
		check(
			"packages/contracts/fixtures/citation-diagnostic.v1.json",
			["execution-control#native:test", "campus-contracts#test"],
			["ingestion-contracts#test"],
		);
		check(
			"packages/ui/test/confirm-dialog.test.tsx",
			["@campus-agent/ui#test", "@campus-agent/ui#typecheck"],
			["campus-web#test:dom:fast", "ops-web#test:dom:fast", "ops-web#build"],
		);
		check(
			"packages/ui/src/confirm-dialog.tsx",
			[
				"@campus-agent/ui#test",
				"campus-web#test:dom:fast",
				"ops-web#test:dom:fast",
				"ops-web#build",
			],
			[
				"ingestion-contracts#test",
				"@campus-agent/tooling#test:hooks",
				"@campus-agent/tooling#test:docs",
			],
		);
		check(
			"packages/contracts/schemas/campus-docs-reader.v3.schema.json",
			["campus-web#test:node:fast", "campus-web#build:worker"],
			["ingestion-contracts#test"],
		);
		check(
			"apps/app-api/test/worker.test.ts",
			["app-api#test:worker"],
			["app-api#test:node:fast", "campus-web#test:dom:fast", "app-api#build:worker"],
		);
		check(
			"apps/campus-web/test/date-picker.test.tsx",
			["campus-web#test:dom:fast", "campus-web#typecheck"],
			["campus-web#test:node:fast", "app-api#test:worker", "campus-web#build:worker"],
		);
		check(
			"apps/agent-runtime/test/tool-catalog.test.ts",
			["agent-runtime#test"],
			["agent-runtime#build", "@campus-agent/tooling#test:hooks"],
		);
		const worker = baseline.tasks.find((t) => t.taskId === "app-api#test:worker");
		check(
			"apps/campus-web/src/app/routes/dining-page.tsx",
			["campus-web#test:dom:fast", "campus-web#build:worker"],
			["app-api#test:worker", "app-api#build:worker", "ops-web#build"],
		);
		assert(worker && !worker.dependencies.some((id) => id.startsWith("campus-web#")));
		const selected = parseTurboTasks(JSON.stringify(baseline));
		assert(
			!selected.some(
				(t) => t.task === "test" && ["app-api", "campus-web", "ops-web"].includes(t.package),
			),
		);
		assert(
			!selected.some(
				(t) => t.task === "source" || (t.package === "status-web" && t.task === "build"),
			),
		);
		assert(selected.some((t) => t.package === "status-web" && t.task === "build:worker"));

		const runtimeBefore = env.CAMPUS_NODE_RUNTIME;
		env.CAMPUS_NODE_RUNTIME = "different-runtime";
		assert.notEqual(
			hashes(dry()).get("ingestion-contracts#test"),
			before.get("ingestion-contracts#test"),
		);
		env.CAMPUS_NODE_RUNTIME = runtimeBefore;

		// Exercise actual cache execution without running a real integration service in the fixture.
		const manifestFile = "packages/ingestion-contracts/package.json";
		const manifest = JSON.parse(readFileSync(path.join(fixture, manifestFile), "utf8"));
		manifest.scripts.test =
			"node -e \"console.log('cache probe'); if (require('node:fs').readFileSync('src/raw-error.ts','utf8').includes('CACHE_PROBE_FAIL')) process.exit(17)\"";
		write(manifestFile, JSON.stringify(manifest));
		const run = () =>
			spawnSync("pnpm", ["exec", "turbo", "run", "ingestion-contracts#test", "--summarize"], {
				cwd: fixture,
				env,
				encoding: "utf8",
			});
		assert.equal(run().status, 0);
		const repeated = run();
		assert.equal(repeated.status, 0);
		assert.match(repeated.stdout, /1 cached, 1 total/u);
		write("packages/ingestion-contracts/src/raw-error.ts", "// CACHE_PROBE_FAIL\n");
		for (let attempt = 0; attempt < 2; attempt++) {
			const failed = run();
			assert.notEqual(failed.status, 0);
			assert.match(failed.stdout + failed.stderr, /cache miss/u);
		}
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
