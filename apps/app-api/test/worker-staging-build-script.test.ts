// @vitest-environment node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = resolve(fileURLToPath(import.meta.url), "..");
const repoRoot = resolve(testDir, "../../..");
const stagingBuildScript = resolve(repoRoot, "scripts/run-worker-staging-build.mjs");

describe("worker staging build wrapper", () => {
	it("removes generated dist .dev.vars files before scanning build output", () => {
		const workDir = mkdtempSync(join(tmpdir(), "worker-staging-build-"));
		const childSource = `
			const { mkdirSync, writeFileSync } = require("node:fs");
			const { join } = require("node:path");
			const workerDist = join(process.cwd(), "dist", "public_chat_web");
			mkdirSync(workerDist, { recursive: true });
			writeFileSync(join(workerDist, ".dev.vars"), 'SENTRY_DSN = "__campus_agent_runtime_secret_placeholder__SENTRY_DSN"\\n');
			writeFileSync(join(workerDist, "index.js"), 'export default {};\\n');
		`;

		const result = spawnSync(
			process.execPath,
			[stagingBuildScript, "SENTRY_DSN", "--", process.execPath, "-e", childSource],
			{
				cwd: workDir,
				encoding: "utf8",
				env: {
					...process.env,
					SENTRY_DSN: "",
				},
			},
		);

		const generatedDevVarsPath = join(workDir, "dist", "public_chat_web", ".dev.vars");
		expect(result.stderr).not.toContain("runtime secret placeholder leaked");
		expect(result.status).toBe(0);
		expect(existsSync(generatedDevVarsPath)).toBe(false);
	});

	it("still fails when a runtime secret placeholder reaches deployable code", () => {
		const workDir = mkdtempSync(join(tmpdir(), "worker-staging-build-"));
		const workerDist = join(workDir, "dist", "public_chat_web");
		mkdirSync(workerDist, { recursive: true });
		const childSource = `
			const { writeFileSync } = require("node:fs");
			const { join } = require("node:path");
			writeFileSync(join(process.cwd(), "dist", "public_chat_web", "index.js"), 'const dsn = "__campus_agent_runtime_secret_placeholder__SENTRY_DSN";\\n');
		`;

		const result = spawnSync(
			process.execPath,
			[stagingBuildScript, "SENTRY_DSN", "--", process.execPath, "-e", childSource],
			{
				cwd: workDir,
				encoding: "utf8",
				env: {
					...process.env,
					SENTRY_DSN: "",
				},
			},
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("runtime secret placeholder leaked into build artifact");
		expect(readFileSync(join(workerDist, "index.js"), "utf8")).toContain(
			"__campus_agent_runtime_secret_placeholder__SENTRY_DSN",
		);
	});
});
