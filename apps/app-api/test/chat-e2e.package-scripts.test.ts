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
		expect(packageJson.scripts["chat:memory:e2e:staging"]).toContain(
			"scripts/chat-memory-e2e-staging.ts",
		);
		expect(packageJson.scripts["chat:memory:e2e:staging"]).toContain(
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
		expect(scriptSource).toContain("CAMPUS_WEB_LIVE_SMOKE");
		expect(scriptSource).toContain("node_modules/vite/bin/vite.js");
		expect(scriptSource).toContain("waitForReadyzWhileChildAlive");
		expect(scriptSource).toContain("--force-recreate");
		expect(scriptSource).toContain("--no-build");
		expect(scriptSource).toContain('"--profile"');
		expect(scriptSource).toContain('"dev"');
	});

	it("keeps local real-provider e2e on the online answer RAG path", () => {
		const scriptSource = readFileSync(
			resolve(__dirname, "../scripts/chat-e2e-local-real-provider.ts"),
			"utf8",
		);
		const retiredPythonSdkRuntimeFlag = ["SUPERVISOR", "AGENTS", "SDK", "RUNTIME", "ENABLED"].join(
			"_",
		);

		expect(scriptSource).toContain("chat-e2e-local-dev.ts");
		expect(scriptSource).not.toContain("PROMPT_RUNTIME_PROVIDER");
		expect(scriptSource).toContain("EXECUTION_CONTROL_TIMEOUT_MS");
		expect(scriptSource).toContain("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH");
		expect(scriptSource).not.toContain("EXECUTION_CONTROL_REQUEST_TIMEOUT_MS");
		expect(scriptSource).not.toContain(retiredPythonSdkRuntimeFlag);
		expect(scriptSource).not.toContain("retired-python-worker-timeout");
		expect(scriptSource).toContain("CHAT_E2E_LOCAL_REAL_PROVIDER_TIMEOUT_MS");
		expect(scriptSource).toContain('"--restart-campus-web"');
		expect(scriptSource).toContain('"--restart-execution-control-runtime"');
		expect(scriptSource).not.toContain('"--restart-supervisor-runtime"');
		expect(scriptSource).toContain('"--expect-model-execution-state"');
		expect(scriptSource).toContain('"rag_sdk_completed"');
		expect(scriptSource).toContain("中央民族大学本科学生国家奖学金评审办法");
		expect(scriptSource).not.toContain("process.kill(process.pid, signal)");
		expect(scriptSource).not.toContain("agents_sdk_notice_discover_e2e_smoke");
		expect(scriptSource).not.toContain("notice_discover");
	});

	it("exposes local provider-config seeding without prompt runtime env", () => {
		const rootPackageJson = JSON.parse(
			readFileSync(resolve(__dirname, "../../../package.json"), "utf8"),
		) as {
			scripts: Record<string, string>;
		};
		const turboJson = JSON.parse(
			readFileSync(resolve(__dirname, "../../../turbo.json"), "utf8"),
		) as {
			tasks: Record<string, { cache?: boolean }>;
		};
		const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		const scriptSource = readFileSync(
			resolve(__dirname, "../scripts/seed-local-provider-config.ts"),
			"utf8",
		);
		const runWithLocalEnvSource = readFileSync(
			resolve(__dirname, "../scripts/run-with-local-env.mjs"),
			"utf8",
		);

		expect(rootPackageJson.scripts["local:providers:seed"]).toBe(
			"turbo run local:providers:seed --filter=app-api",
		);
		expect(turboJson.tasks["local:providers:seed"]).toMatchObject({ cache: false });
		expect(packageJson.scripts["local:providers:seed"]).toBe(
			packageJson.scripts["provider-config:seed-local-model"],
		);
		expect(packageJson.scripts["provider-config:seed-local-model"]).toContain(
			"seed-local-provider-config.ts",
		);
		expect(scriptSource).toContain("primary_agent");
		expect(scriptSource).toContain("rag_synthesis");
		expect(scriptSource).toContain("LLM_API_KEY");
		expect(scriptSource).toContain("LLM_MODEL");
		expect(scriptSource).toContain("RAG_SYNTHESIS_MODEL");
		expect(scriptSource).toContain("Qwen3-Embedding-4B");
		expect(scriptSource).toContain("EMBEDDING_API_KEY");
		expect(scriptSource).toContain("RERANK_API_KEY");
		expect(scriptSource).toContain("RERANK_MODEL");
		expect(scriptSource).toContain("/rerank");
		expect(scriptSource).toContain("x-app-internal-auth");
		expect(scriptSource).toContain("x-app-operator-email");
		expect(scriptSource).toContain("--stage");
		expect(scriptSource).toContain("prompt");
		expect(scriptSource).toContain("embedding");
		expect(scriptSource).toContain("rerank");
		expect(runWithLocalEnvSource).toContain("repoEnvPath");
		expect(runWithLocalEnvSource).toContain("generatedRuntimeEnvPath");
		expect(runWithLocalEnvSource).toContain("project-local-runtime-env.mjs");
		expect(scriptSource).not.toContain("PROMPT_RUNTIME");
		expect(scriptSource).not.toContain("EXECUTION_PROMPT_MODEL");
	});
});
