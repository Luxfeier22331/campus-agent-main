// @vitest-environment node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(testDir, "../../..");
const stagingBuildScript = resolve(repoRoot, "scripts/deploy/run-worker-staging-build.ts");
const tsxBin = resolve(repoRoot, "node_modules/.bin/tsx");

describe("worker staging build wrapper", () => {
	it("allows staging builds that do not need runtime secret placeholders", () => {
		const workDir = mkdtempSync(join(tmpdir(), "worker-staging-build-"));
		const childSource = `
			const { mkdirSync, writeFileSync } = require("node:fs");
			const { join } = require("node:path");
			const workerDist = join(process.cwd(), "dist", "campus_web");
			mkdirSync(workerDist, { recursive: true });
			writeFileSync(join(workerDist, "index.js"), 'export default {};\\n');
		`;

		const result = spawnSync(
			tsxBin,
			[stagingBuildScript, "--", process.execPath, "-e", childSource],
			{
				cwd: workDir,
				encoding: "utf8",
				env: {
					...process.env,
				},
			},
		);

		expect(result.stderr).not.toContain("Usage:");
		expect(result.status).toBe(0);
	});

	it("removes generated dist .dev.vars files before scanning build output", () => {
		const workDir = mkdtempSync(join(tmpdir(), "worker-staging-build-"));
		const childSource = `
				const { mkdirSync, writeFileSync } = require("node:fs");
				const { join } = require("node:path");
				const workerDist = join(process.cwd(), "dist", "campus_web");
				mkdirSync(workerDist, { recursive: true });
				writeFileSync(join(workerDist, ".dev.vars"), 'APP_API_EXECUTION_SHARED_SECRET = "__campus_agent_runtime_secret_placeholder__APP_API_EXECUTION_SHARED_SECRET"\\n');
				writeFileSync(join(workerDist, "index.js"), 'export default {};\\n');
			`;

		const result = spawnSync(
			tsxBin,
			[
				stagingBuildScript,
				"APP_API_EXECUTION_SHARED_SECRET",
				"--",
				process.execPath,
				"-e",
				childSource,
			],
			{
				cwd: workDir,
				encoding: "utf8",
				env: {
					...process.env,
					APP_API_EXECUTION_SHARED_SECRET: "",
				},
			},
		);

		const generatedDevVarsPath = join(workDir, "dist", "campus_web", ".dev.vars");
		expect(result.stderr).not.toContain("runtime secret placeholder leaked");
		expect(result.status).toBe(0);
		expect(existsSync(generatedDevVarsPath)).toBe(false);
	}, 30_000);

	it("still fails when a runtime secret placeholder reaches deployable code", () => {
		const workDir = mkdtempSync(join(tmpdir(), "worker-staging-build-"));
		const workerDist = join(workDir, "dist", "campus_web");
		mkdirSync(workerDist, { recursive: true });
		const childSource = `
				const { writeFileSync } = require("node:fs");
				const { join } = require("node:path");
				writeFileSync(join(process.cwd(), "dist", "campus_web", "index.js"), 'const secret = "__campus_agent_runtime_secret_placeholder__APP_API_EXECUTION_SHARED_SECRET";\\n');
			`;

		const result = spawnSync(
			tsxBin,
			[
				stagingBuildScript,
				"APP_API_EXECUTION_SHARED_SECRET",
				"--",
				process.execPath,
				"-e",
				childSource,
			],
			{
				cwd: workDir,
				encoding: "utf8",
				env: {
					...process.env,
					APP_API_EXECUTION_SHARED_SECRET: "",
				},
			},
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("runtime secret placeholder leaked into build artifact");
		expect(readFileSync(join(workerDist, "index.js"), "utf8")).toContain(
			"__campus_agent_runtime_secret_placeholder__APP_API_EXECUTION_SHARED_SECRET",
		);
	}, 30_000);
});
