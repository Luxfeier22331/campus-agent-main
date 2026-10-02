import { resolve } from "node:path";
import type {
	AgentRunnerInput,
	AgentRunnerResult,
} from "../../../agent-runtime/src/agent-run-contract.ts";
import { createAgentRuntimeHandler } from "../../../agent-runtime/src/http-server.ts";
import { createAgentRuntimeNodeServer } from "../../../agent-runtime/src/node-http.ts";
import { loadToolCatalog } from "../../../agent-runtime/src/tool-catalog.ts";
import { createWorkflowOperationRuntime } from "../../../agent-runtime/src/workflow-runtime.ts";

// The provider boundary is controlled; HTTP parsing, model output parsing,
// operation mapping, tool evidence construction and SSE encoding are production.
const catalog = loadToolCatalog(resolve("../../configs/runtime/tools.v7.json"));
async function runner(input: AgentRunnerInput): Promise<AgentRunnerResult> {
	const memory = input.requestId.includes("runtime-memory");
	const result: AgentRunnerResult = {
		finalOutput: "",
		providerResponseId: "integration-provider",
		toolResults: [],
		webCitations: [],
		webSearchUsed: false,
		usage: { modelRequestCount: 1, inputTokens: 12, outputTokens: 8, usageObserved: true },
	};
	switch (input.operation) {
		case "solve":
			result.finalOutput = JSON.stringify({
				outcome: "plan",
				plan: {
					schemaVersion: "task_plan.v1",
					goal: "校园服务指南",
					steps: [
						{
							id: "step.campus",
							objective: "校园服务指南",
							candidateSources: [memory ? "personal_memory_recall" : "campus_search"],
							dependsOn: [],
						},
					],
				},
			});
			break;
		case "execute_step":
			result.finalOutput = JSON.stringify({
				summary: "暂未找到资料",
				remainingFacts: memory ? [] : ["校园服务指南"],
			});
			result.toolResults = [
				{
					toolName: memory ? "personal_memory_recall" : "campus_search",
					status: "completed",
					invocationId: "integration-tool",
					argumentsJson: { search_query: "private-query-sentinel" },
					durationMs: 1,
					result: memory
						? {
								outcome: "matched",
								memory_text: "😀".repeat(4000),
								query: "private-query-sentinel",
								debug: "private-debug-sentinel",
							}
						: { outcome: "no_match", results: [] },
				},
			];
			break;
		case "replan":
			result.finalOutput = JSON.stringify({
				schemaVersion: "task_replan.v3",
				decision: "synthesize",
				reason: "资料不足",
				remainingSteps: [],
			});
			break;
		case "synthesize":
			result.finalOutput = "暂未找到相关校园服务资料。";
			break;
		default:
			throw new Error("unsupported operation");
	}
	return result;
}
const runtime = createWorkflowOperationRuntime({
	catalog,
	runner,
	streamingRunner: async function* (input) {
		if (input.operation === "solve") {
			yield { solveOutcome: "plan" as const };
		}
		yield await runner(input);
	},
});
const handler = createAgentRuntimeHandler({
	runtime,
	runtimeRelease: "integration-current",
	sharedSecret: "integration-secret",
	modelConfig: {
		baseUrl: "http://controlled-model-config",
		fetchImplementation: async () =>
			Response.json({
				api_key: "unused",
				api_protocol: "openai.responses",
				base_url: "http://controlled-provider",
				model: "integration-model",
				name: "primary_agent",
				provider: "openai",
				schema_version: "model_runtime_config.v1",
				target_sha256: "a".repeat(64),
			}),
	},
});
const server = createAgentRuntimeNodeServer({ handler, sharedSecret: "integration-secret" });
server.listen(0, "127.0.0.1", () => {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("missing listener");
	}
	process.stdout.write(`http://127.0.0.1:${address.port}\n`);
});
process.once("SIGTERM", () => server.close(() => process.exit(0)));
