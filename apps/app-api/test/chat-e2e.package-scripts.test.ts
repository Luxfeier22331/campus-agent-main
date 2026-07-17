// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
	scripts: Record<string, string>;
};
const rootPackageJson = JSON.parse(
	readFileSync(resolve(__dirname, "../../../package.json"), "utf8"),
) as {
	scripts: Record<string, string>;
};

describe("chat e2e package scripts", () => {
	it("keeps chat e2e public entrypoints under root scripts", () => {
		const rootScript = rootPackageJson.scripts["smoke:app-api"];

		expect(packageJson.scripts["chat:e2e"]).toBeUndefined();
		expect(packageJson.scripts["chat:e2e:dev"]).toBeUndefined();
		expect(packageJson.scripts["chat:e2e:staging"]).toBeUndefined();
		expect(rootScript).toBe("pnpm exec tsx scripts/smoke/app-api.ts");
		const publicEntry = readFileSync(
			resolve(__dirname, "../../../scripts/smoke/app-api.ts"),
			"utf8",
		);
		expect(publicEntry).toContain("chat-e2e.ts");
		expect(publicEntry).toContain("chat-e2e-local-dev.ts");
		expect(publicEntry).toContain("chat-e2e-local-provider.ts");
		expect(publicEntry).toContain("chat-durable-staging.ts");
		expect(publicEntry).toContain("run-with-staging-smoke-env.ts");
		expect(packageJson.scripts["chat:durable:e2e:staging"]).toBeUndefined();
		expect(packageJson.scripts["chat:memory:e2e:staging"]).toBeUndefined();
		expect(packageJson.scripts["chat:e2e:local-provider"]).toBeUndefined();
		expect(packageJson.scripts["hindsight:memory:e2e:staging"]).toBeUndefined();
		const publicScriptNames = Object.keys(packageJson.scripts);
		expect(publicScriptNames).not.toContainEqual(
			expect.stringMatching(/(?:runtime-db|db|database).*proof.*staging/),
		);
	});

	it("does not keep the legacy staging smoke command as a public script", () => {
		expect(packageJson.scripts["chat:smoke:staging"]).toBeUndefined();
		expect(packageJson.scripts["hindsight:memory:e2e:staging"]).toBeUndefined();
	});

	it("does not expose the retired self-built online answer eval collector", () => {
		expect(packageJson.scripts["online-answer-path:collect:staging"]).toBeUndefined();
	});

	it("keeps local dev e2e on pre-existing runtime readiness instead of starting runtime", () => {
		const scriptSource = readFileSync(resolve(__dirname, "../e2e/chat-e2e-local-dev.ts"), "utf8");
		const retiredStartScript = `${["start", "execution", "control", "runtime"].join("-")}.sh`;

		expect(scriptSource).toContain("isReadyzReady(args.execReadyzUrl)");
		expect(scriptSource).toContain("Start the runtime through the platform-owned deployment path");
		expect(scriptSource).toContain("bootstrap-shared-product-database.ts");
		expect(scriptSource).toContain("provision-smoke-identity.ts");
		expect(scriptSource).toContain("CAMPUS_WEB_LIVE_SMOKE");
		expect(scriptSource).toContain("node_modules/vite/bin/vite.js");
		expect(scriptSource).toContain("waitForReadyzWhileChildAlive");
		expect(scriptSource).not.toContain(retiredStartScript);
		expect(scriptSource).not.toContain("--force-recreate");
		expect(scriptSource).not.toContain("--no-build");
		expect(scriptSource).toContain('"--profile"');
		expect(scriptSource).toContain('"dev"');
	});

	it("keeps local provider e2e behind the root smoke dispatcher", () => {
		const scriptSource = readFileSync(
			resolve(__dirname, "../e2e/chat-e2e-local-provider.ts"),
			"utf8",
		);
		const retiredPythonSdkRuntimeFlag = [
			"SUPER",
			"VISOR",
			"AGENTS",
			"SDK",
			"RUNTIME",
			"ENABLED",
		].join("_");
		const retiredRestartFlag = ["--restart", "super", "visor", "runtime"].join("-");
		const retiredExecutionRestartFlag = ["--restart", "execution", "control", "runtime"].join("-");

		expect(scriptSource).toContain("chat-e2e-local-dev.ts");
		expect(scriptSource).not.toContain("PROMPT_RUNTIME_PROVIDER");
		expect(scriptSource).toContain("EXECUTION_CONTROL_TIMEOUT_MS");
		expect(scriptSource).toContain("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH");
		expect(scriptSource).not.toContain("EXECUTION_CONTROL_REQUEST_TIMEOUT_MS");
		expect(scriptSource).not.toContain(retiredPythonSdkRuntimeFlag);
		expect(scriptSource).not.toContain(retiredRestartFlag);
		expect(scriptSource).not.toContain("retired-python-worker-timeout");
		expect(scriptSource).toContain("CHAT_E2E_LOCAL_PROVIDER_TIMEOUT_MS");
		expect(scriptSource).toContain('"--restart-campus-web"');
		expect(scriptSource).not.toContain(JSON.stringify(retiredExecutionRestartFlag));
		expect(scriptSource).not.toContain('"--restart-executionClient-runtime"');
		expect(scriptSource).toContain('"--expect-model-execution-state"');
		expect(scriptSource).toContain('"go_provider_synthesis_completed"');
		expect(scriptSource).toContain("process.argv.slice(2)");
		expect(scriptSource).toContain("示例大学本科学生国家奖学金评审办法");
		expect(scriptSource).not.toContain("process.kill(process.pid, signal)");
		expect(scriptSource).not.toContain("agents_sdk_notice_discover_e2e_smoke");
		expect(scriptSource).not.toContain("notice_discover");
	});
});
