// Manual full-stack smoke fixture. From apps/agent-runtime, after stopping only
// that worktree's normal Runtime:
// node --env-file=.env.local test/fixtures/deadline-runtime.ts
// Restore `pnpm dev` after the request and delayed cleanup both finish.
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { setTracingDisabled } from "@openai/agents";
import { createAgentRuntimeHandler } from "../../src/http-server.ts";
import { createAgentRuntimeNodeServer } from "../../src/node-http.ts";
import { agentRuntimeErrorLogFields } from "../../src/runtime-errors.ts";
import {
	createOpenAIAgentsRunner,
	createStreamingOpenAIAgentsRunner,
} from "../../src/sdk-runner.ts";
import { exactSharedSecret, loadAgentRuntimeServerConfig } from "../../src/server-config.ts";
import { loadToolCatalog } from "../../src/tool-catalog.ts";
import { createExecutionControlToolExecutor } from "../../src/tool-executor.ts";
import { createWorkflowOperationRuntime } from "../../src/workflow-runtime.ts";
import { delayedCancellationModel } from "../helpers/delayed-cancellation-model.ts";

setTracingDisabled(true);
const { host, port } = loadAgentRuntimeServerConfig();
const secret = exactSharedSecret(process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET);
const catalog = loadToolCatalog(
	resolve(fileURLToPath(new URL("../../../../", import.meta.url)), "configs/runtime/tools.v7.json"),
);
const model = delayedCancellationModel({
	onAbort: () =>
		console.info(
			JSON.stringify({ event: "controlled_model_aborted", at: new Date().toISOString() }),
		),
	async afterAbort() {
		await delay(10000);
		console.info(
			JSON.stringify({ event: "controlled_model_cleanup_finished", at: new Date().toISOString() }),
		);
	},
});
const modelProvider = {
	async getModel() {
		return model;
	},
};
const runtime = createWorkflowOperationRuntime({
	catalog,
	runner: createOpenAIAgentsRunner({ model: "controlled-timeout", modelProvider }),
	streamingRunner: createStreamingOpenAIAgentsRunner({
		model: "controlled-timeout",
		modelProvider,
	}),
	toolExecutor: createExecutionControlToolExecutor({
		baseUrl: process.env.AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL ?? "",
		sharedSecret: secret,
	}),
});
const log: NonNullable<Parameters<typeof createAgentRuntimeHandler>[0]["onRunError"]> = (
	error,
	context,
) => {
	console.info(
		JSON.stringify({
			at: new Date().toISOString(),
			request_id: context.requestId,
			...agentRuntimeErrorLogFields(error, context.failure),
		}),
	);
};
const server = createAgentRuntimeNodeServer({
	sharedSecret: secret,
	handler: createAgentRuntimeHandler({
		runtime,
		sharedSecret: secret,
		modelConfig: { baseUrl: process.env.MODEL_CONFIG_URL ?? "" },
		runtimeRelease: process.env.DEPLOYMENT_RELEASE ?? "controlled-timeout",
		onRunError: log,
		onStreamError: log,
	}),
});
server.listen(port, host, () =>
	console.info(JSON.stringify({ event: "controlled_runtime_ready", port })),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => server.close());
}
