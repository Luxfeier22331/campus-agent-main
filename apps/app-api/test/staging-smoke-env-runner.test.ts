import { describe, expect, it } from "vitest";
import loadRepoEnvSource from "../../../scripts/load-repo-env.mjs?raw";
import rootRunWithStagingSmokeEnvSource from "../../../scripts/run-with-staging-smoke-env.mjs?raw";
import runWithStagingSmokeEnvSource from "../scripts/run-with-staging-smoke-env.mjs?raw";

describe("staging smoke env runner", () => {
	it("serializes staging smoke commands that share the fixed smoke identity", () => {
		expect(runWithStagingSmokeEnvSource).toContain("STAGING_SMOKE_LOCK_PATH");
		expect(runWithStagingSmokeEnvSource).toContain(".tmp/staging-smoke.lock");
		expect(runWithStagingSmokeEnvSource).toContain("openSync");
		expect(runWithStagingSmokeEnvSource).toContain('"wx"');
		expect(runWithStagingSmokeEnvSource).toContain("releaseStagingSmokeLock");
		expect(runWithStagingSmokeEnvSource).toContain('process.on("SIGINT"');
		expect(runWithStagingSmokeEnvSource).toContain('process.on("SIGTERM"');
	});

	it("provides the repo-level runner used by cross-app staging smoke scripts", () => {
		expect(rootRunWithStagingSmokeEnvSource).toContain("loadStagingSmokeEnvFile");
		expect(rootRunWithStagingSmokeEnvSource).toContain("--cwd");
		expect(rootRunWithStagingSmokeEnvSource).toContain("STAGING_SMOKE_LOCK_PATH");
		expect(rootRunWithStagingSmokeEnvSource).toContain(".tmp/staging-smoke.lock");
		expect(rootRunWithStagingSmokeEnvSource).toContain("openSync");
		expect(rootRunWithStagingSmokeEnvSource).toContain('"wx"');
		expect(rootRunWithStagingSmokeEnvSource).toContain("releaseStagingSmokeLock");
	});

	it("loads only explicit ops-owned staging runtime env for smoke scripts", () => {
		expect(loadRepoEnvSource).not.toContain("/srv/docker/campus-agent/staging/env/runtime.env");
		expect(loadRepoEnvSource).toContain("STAGING_RUNTIME_ENV_FILE");
		expect(loadRepoEnvSource).toContain("EXECUTION_CONTROL_STAGING_ENV_FILE");
		for (const source of [runWithStagingSmokeEnvSource, rootRunWithStagingSmokeEnvSource]) {
			expect(source).toContain("loadStagingSmokeEnvFile");
			expect(source).not.toContain("loadRepoStagingEnvFile");
			expect(source).not.toContain("process.loadEnvFile");
		}
	});
});
