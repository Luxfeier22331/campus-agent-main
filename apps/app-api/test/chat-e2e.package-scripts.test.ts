// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
	scripts: Record<string, string>;
};

describe("chat e2e package scripts", () => {
	it("exposes environment-neutral and profile-specific chat e2e commands", () => {
		expect(packageJson.scripts["chat:e2e"]).toContain("scripts/chat-e2e.ts");
		expect(packageJson.scripts["chat:e2e:dev"]).toContain("scripts/chat-e2e-local-dev.ts");
		expect(packageJson.scripts["chat:e2e:staging"]).toContain("--profile staging");
		expect(packageJson.scripts["chat:durable:e2e:staging"]).toContain(
			"scripts/chat-durable-e2e-staging.ts",
		);
		expect(packageJson.scripts["chat:durable:e2e:staging"]).toContain(
			"run-with-staging-smoke-env.mjs",
		);
		expect(packageJson.scripts["chat:e2e:local-real-provider"]).toContain(
			"scripts/chat-e2e-local-real-provider.ts",
		);
	});

	it("does not keep the legacy staging smoke command as a public script", () => {
		expect(packageJson.scripts["chat:smoke:staging"]).toBeUndefined();
	});

	it("keeps local dev e2e as a repo-owned runtime orchestration entry", () => {
		const scriptSource = readFileSync(
			resolve(__dirname, "../scripts/chat-e2e-local-dev.ts"),
			"utf8",
		);

		expect(scriptSource).toContain("infra/local/start-execution-control-runtime.sh");
		expect(scriptSource).toContain("isReadyzReady(args.execReadyzUrl)");
		expect(scriptSource).toContain("db:bootstrap");
		expect(scriptSource).toContain("smoke-identity:provision");
		expect(scriptSource).toContain("PUBLIC_CHAT_LIVE_SMOKE");
		expect(scriptSource).toContain("node_modules/vite/bin/vite.js");
		expect(scriptSource).toContain("waitForReadyzWhileChildAlive");
		expect(scriptSource).toContain("--force-recreate");
		expect(scriptSource).toContain("--no-build");
		expect(scriptSource).toContain('"--profile"');
		expect(scriptSource).toContain('"dev"');
	});

	it("keeps local real-provider e2e on the public chat RAG path", () => {
		const scriptSource = readFileSync(
			resolve(__dirname, "../scripts/chat-e2e-local-real-provider.ts"),
			"utf8",
		);

		expect(scriptSource).toContain("chat-e2e-local-dev.ts");
		expect(scriptSource).toContain("SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED");
		expect(scriptSource).toContain("PROMPT_RUNTIME_PROVIDER");
		expect(scriptSource).toContain("EXECUTION_CONTROL_TIMEOUT_MS");
		expect(scriptSource).not.toContain("SUPERVISOR_API_REQUEST_TIMEOUT_MS");
		expect(scriptSource).toContain("SUPERVISOR_AGENT_WORKER_TIMEOUT_MS");
		expect(scriptSource).toContain("CHAT_E2E_LOCAL_REAL_PROVIDER_TIMEOUT_MS");
		expect(scriptSource).toContain('"--restart-public-chat"');
		expect(scriptSource).toContain('"--restart-supervisor-runtime"');
		expect(scriptSource).toContain('"--expect-prompt-runtime-state"');
		expect(scriptSource).toContain('"rag_sdk_completed"');
		expect(scriptSource).toContain("中央民族大学本科学生国家奖学金评审办法");
		expect(scriptSource).not.toContain("process.kill(process.pid, signal)");
		expect(scriptSource).not.toContain("agents_sdk_notice_discover_e2e_smoke");
		expect(scriptSource).not.toContain("notice_discover");
	});
});
