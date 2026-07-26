// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootPackageJson = JSON.parse(
	readFileSync(resolve(__dirname, "../../../package.json"), "utf8"),
) as {
	scripts: Record<string, string>;
};

describe("chat e2e package scripts", () => {
	it("keeps chat e2e public entrypoints under root scripts", () => {
		const rootScript = rootPackageJson.scripts["smoke:app-api"];

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
	});

	it("keeps local dev e2e on pre-existing runtime readiness instead of starting runtime", () => {
		const scriptSource = readFileSync(resolve(__dirname, "../e2e/chat-e2e-local-dev.ts"), "utf8");

		expect(scriptSource).toContain("isReadyzReady(args.execReadyzUrl)");
		expect(scriptSource).toContain("Start the runtime through the platform-owned deployment path");
		expect(scriptSource).toContain("bootstrap-shared-product-database.ts");
		expect(scriptSource).toContain("provision-smoke-identity.ts");
		expect(scriptSource).toContain("CAMPUS_WEB_LIVE_SMOKE");
		expect(scriptSource).toContain("node_modules/vite/bin/vite.js");
		expect(scriptSource).toContain("waitForReadyzWhileChildAlive");
		expect(scriptSource).toContain('"--profile"');
		expect(scriptSource).toContain('"dev"');
	});

	it("keeps local provider e2e behind the root smoke dispatcher", () => {
		const scriptSource = readFileSync(
			resolve(__dirname, "../e2e/chat-e2e-local-provider.ts"),
			"utf8",
		);

		expect(scriptSource).toContain("chat-e2e-local-dev.ts");
		expect(scriptSource).not.toContain("EXECUTION_CONTROL_TIMEOUT_MS");
		expect(scriptSource).not.toContain("CHAT_E2E_LOCAL_PROVIDER_TIMEOUT_MS");
		expect(scriptSource).toContain('"--restart-campus-web"');
		expect(scriptSource).toContain('"--expect-model-execution-state"');
		expect(scriptSource).toContain('"go_provider_synthesis_completed"');
		expect(scriptSource).toContain("process.argv.slice(2)");
		expect(scriptSource).toContain("示例大学本科学生国家奖学金评审办法");
	});
});
