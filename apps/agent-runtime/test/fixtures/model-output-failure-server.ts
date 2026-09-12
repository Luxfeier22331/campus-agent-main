// Local smoke fixture only. Real model/tools, with one terminal Executor text
// replaced after the second retrieval. Never imported by the production server.
import { resolve } from "node:path";
import { createAgentRuntimeHandler } from "../../src/http-server.ts";
import { createAgentRuntimeNodeServer } from "../../src/node-http.ts";
import {
	createConfiguredRunner,
	createConfiguredStreamingRunner,
} from "../../src/provider-config.ts";
import { exactSharedSecret, loadAgentRuntimeServerConfig } from "../../src/server-config.ts";
import { loadToolCatalog } from "../../src/tool-catalog.ts";
import { createExecutionControlToolExecutor } from "../../src/tool-executor.ts";
import { createWorkflowOperationRuntime } from "../../src/workflow-runtime.ts";

const config = loadAgentRuntimeServerConfig();
if (config.host !== "127.0.0.1") {
	throw new Error("Smoke fixture must bind to loopback");
}
const sharedSecret = exactSharedSecret(process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET);
const native = createConfiguredRunner();
let replaced = false;
const runtime = createWorkflowOperationRuntime({
	catalog: loadToolCatalog(resolve("../../configs/runtime/tools.v7.json")),
	streamingRunner: createConfiguredStreamingRunner(),
	runner: async (input) => {
		const result = await native(input);
		if (
			!replaced &&
			input.operation === "execute_step" &&
			input.citationStart >= 2 &&
			result.toolResults.some(
				(item) => item.toolName === "campus_search" && item.status === "completed",
			) &&
			!result.failure
		) {
			replaced = true;
			const text = "[受控格式错误验收] 检索已完成，但这不是 JSON。";
			delete result.structuredOutput;
			result.finalOutput = text;
			result.rawModelOutput = { text, finishReason: result.rawModelOutput?.finishReason ?? "STOP" };
			console.info(
				JSON.stringify({
					event: "test.model_output_replaced",
					request_id: input.requestId,
					operation: input.operation,
				}),
			);
		}
		return result;
	},
	toolExecutor: createExecutionControlToolExecutor({
		baseUrl: requiredSetting("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL"),
		sharedSecret,
	}),
});
const handler = createAgentRuntimeHandler({
	sharedSecret,
	runtime,
	runtimeRelease: requiredSetting("DEPLOYMENT_RELEASE"),
	modelConfig: { baseUrl: requiredSetting("MODEL_CONFIG_URL") },
});
const server = createAgentRuntimeNodeServer({ handler, sharedSecret });
server.listen(config.port, config.host, () =>
	console.info("Controlled output failure fixture ready"),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));

function requiredSetting(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}
