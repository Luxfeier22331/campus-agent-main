import { resolve } from "node:path";
import { loadToolCatalog } from "../../../agent-runtime/src/tool-catalog.ts";
import { createExecutionControlToolExecutor } from "../../../agent-runtime/src/tool-executor.ts";

const tool = loadToolCatalog(resolve("../../configs/runtime/tools.v7.json")).tools.find(
	(entry) => entry.name === "personal_memory_recall",
);
if (!tool) {
	throw new Error("missing recall tool");
}
const execute = createExecutionControlToolExecutor({
	baseUrl: process.argv[2] ?? "",
	sharedSecret: "integration-secret",
});
const result = await execute({
	tool,
	requestId: "recall-transport",
	invocationId: "recall-call",
	workflowStepId: "task.step.memory",
	activityAttempt: 1,
	argumentsJson: { query: "偏好" },
});
process.stdout.write(JSON.stringify(result));
