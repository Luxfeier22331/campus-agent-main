import { describe, expect, it } from "vitest";
import rootPackageManifestRaw from "../../../package.json?raw";
import loadRepoEnvSource from "../../../scripts/deploy/lib/repo-env.ts?raw";
import rootRunWithStagingSmokeEnvSource from "../../../scripts/deploy/run-with-staging-smoke-env.ts?raw";
import appApiSmokeEntrypointSource from "../../../scripts/smoke/app-api.ts?raw";
import packageManifestRaw from "../package.json?raw";

const packageManifest = JSON.parse(packageManifestRaw) as { scripts: Record<string, string> };
const rootPackageManifest = JSON.parse(rootPackageManifestRaw) as {
	scripts: Record<string, string>;
};

describe("staging smoke env runner", () => {
	it("provides the repo-level runner used by cross-app staging smoke scripts", () => {
		expect(rootRunWithStagingSmokeEnvSource).toContain("loadStagingSmokeEnvFile");
		expect(rootRunWithStagingSmokeEnvSource).toContain("--cwd");
		expect(rootRunWithStagingSmokeEnvSource).toContain("STAGING_SMOKE_LOCK_PATH");
		expect(rootRunWithStagingSmokeEnvSource).toContain(".tmp/staging-smoke.lock");
		expect(rootRunWithStagingSmokeEnvSource).toContain("openSync");
		expect(rootRunWithStagingSmokeEnvSource).toContain('"wx"');
		expect(rootRunWithStagingSmokeEnvSource).toContain("releaseStagingSmokeLock");
	});

	it("routes app-api staging smoke through the scripts public entrypoint", () => {
		expect(packageManifest.scripts["chat:e2e:staging"]).toBeUndefined();
		expect(rootPackageManifest.scripts["smoke:app-api"]).toBe(
			"pnpm exec tsx scripts/smoke/app-api.ts",
		);
		expect(appApiSmokeEntrypointSource).toContain("./scripts/deploy/run-with-staging-smoke-env.ts");
		expect(appApiSmokeEntrypointSource).toContain("--cwd");
		expect(appApiSmokeEntrypointSource).toContain("apps/app-api");
		expect(packageManifest.scripts["chat:durable:e2e:staging"]).toBeUndefined();
		expect(packageManifest.scripts["chat:memory:e2e:staging"]).toBeUndefined();
		expect(packageManifest.scripts["hindsight:memory:e2e:staging"]).toBeUndefined();
	});

	it("loads only explicit ops-owned staging runtime env for smoke scripts", () => {
		expect(loadRepoEnvSource).not.toContain("/srv/docker/campus-agent/staging/env/runtime.env");
		expect(loadRepoEnvSource).toContain("STAGING_RUNTIME_ENV_FILE");
		expect(loadRepoEnvSource).toContain("EXECUTION_CONTROL_STAGING_ENV_FILE");
		expect(rootRunWithStagingSmokeEnvSource).toContain("loadStagingSmokeEnvFile");
		expect(rootRunWithStagingSmokeEnvSource).not.toContain("loadRepoStagingEnvFile");
		expect(rootRunWithStagingSmokeEnvSource).not.toContain("process.loadEnvFile");
	});
});
