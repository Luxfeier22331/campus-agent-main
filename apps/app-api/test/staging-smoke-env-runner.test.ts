import { describe, expect, it } from "vitest";
import runWithStagingSmokeEnvSource from "../../../scripts/run-with-staging-smoke-env.mjs?raw";

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
});
