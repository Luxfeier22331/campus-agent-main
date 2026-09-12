// Explicit loopback-only smoke entry. Ordinary requests use the real provider;
// marked requests supply controlled provider frames to exercise the full wire,
// Temporal, finalization, storage and UI path. Never imported by production.
import { resolve } from "node:path";
import type { GenerateContentResponse } from "@google/genai";
import { createStreamingGeminiRunner } from "../../src/gemini-runner.ts";
import { createAgentRuntimeHandler } from "../../src/http-server.ts";
import { createAgentRuntimeNodeServer } from "../../src/node-http.ts";
import {
	createConfiguredRunner,
	createConfiguredStreamingRunner,
} from "../../src/provider-config.ts";
import { AgentRuntimeError } from "../../src/runtime-errors.ts";
import { exactSharedSecret, loadAgentRuntimeServerConfig } from "../../src/server-config.ts";
import { loadToolCatalog } from "../../src/tool-catalog.ts";
import { createExecutionControlToolExecutor } from "../../src/tool-executor.ts";
import { createWorkflowOperationRuntime } from "../../src/workflow-runtime.ts";

const config = loadAgentRuntimeServerConfig();
if (config.host !== "127.0.0.1") {
	throw new Error("Smoke fixture must bind to loopback");
}
const sharedSecret = exactSharedSecret(process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET);
const nativeStream = createConfiguredStreamingRunner();
const controlled = createStreamingGeminiRunner({
	createModels: () => ({
		generateContent: async () => {
			throw new Error("Only streaming is used by this fixture");
		},
		generateContentStream: async () =>
			(async function* () {
				const frame = (text: string, metadata?: Record<string, unknown>) =>
					({
						responseId: "controlled-grounding-smoke",
						candidates: [
							{
								content: { role: "model", parts: [{ text }] },
								finishReason: "STOP",
								groundingMetadata: metadata,
							},
						],
						usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
					}) as unknown as GenerateContentResponse;
				yield frame('{"result":{"outcome":"answer","answer":"【受控验收】海淀');
				yield frame('校区。"}}', {
					webSearchQueries: ["controlled smoke"],
					groundingChunks: [
						{ web: { uri: "https://example.org/smoke-a", title: "受控来源 A" } },
						{ web: { uri: "https://example.org/smoke-b", title: "受控来源 B" } },
					],
					groundingSupports: [
						{ segment: { text: "海淀校区", endIndex: 999 }, groundingChunkIndices: [0, 1] },
						{ segment: { endIndex: 999 }, groundingChunkIndices: [0] },
					],
				});
				yield frame("", { searchEntryPoint: { renderedContent: "<div>受控搜索建议</div>" } });
			})(),
	}),
});
const runtime = createWorkflowOperationRuntime({
	catalog: loadToolCatalog(resolve("../../configs/runtime/tools.v7.json")),
	runner: createConfiguredRunner(),
	streamingRunner: async function* (input) {
		const requestText = input.input.map((message) => message.content).join("\n");
		if (requestText.includes("[smoke:contract-failure]")) {
			throw new AgentRuntimeError("tool_contract_mismatch", "Controlled contract failure", {
				operation: "tool.controlled_smoke",
			});
		}
		yield* requestText.includes("[smoke:grounding]") ? controlled(input) : nativeStream(input);
	},
	toolExecutor: createExecutionControlToolExecutor({
		baseUrl: required("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL"),
		sharedSecret,
	}),
});
const server = createAgentRuntimeNodeServer({
	sharedSecret,
	handler: createAgentRuntimeHandler({
		sharedSecret,
		runtime,
		runtimeRelease: required("DEPLOYMENT_RELEASE"),
		modelConfig: { baseUrl: required("MODEL_CONFIG_URL") },
	}),
});
server.listen(config.port, config.host, () =>
	console.info("Controlled search-boundaries fixture ready"),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}
