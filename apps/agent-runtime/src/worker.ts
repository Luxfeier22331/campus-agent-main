import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createAgentActivities } from "./activities.ts";
import { AgentControlClient } from "./control-client.ts";
import { createGeminiSourceResolver } from "./gemini-source-resolver.ts";
import { startAgentRuntimeTelemetry } from "./telemetry.ts";
import { AGENT_MODEL_QUEUE, AGENT_TOOL_QUEUE, AGENT_WORKFLOW_QUEUE } from "./temporal-contract.ts";
import { loadToolCatalog } from "./tool-catalog.ts";

function required(name: string) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}
const connection = await NativeConnection.connect({
	address: required("AGENT_RUNTIME_TEMPORAL_ADDRESS"),
});
const namespace = process.env.AGENT_RUNTIME_TEMPORAL_NAMESPACE ?? "default";
const control = new AgentControlClient(
	required("AGENT_CONTROL_BASE_URL"),
	required("AGENT_CONTROL_RUNTIME_SHARED_SECRET"),
);
const root =
	process.env.REPOSITORY_ROOT ?? resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const resolver = createGeminiSourceResolver();
const telemetry = startAgentRuntimeTelemetry();
const activities = createAgentActivities({
	control,
	catalog: loadToolCatalog(resolve(root, "configs/runtime/tools.v7.json")),
	domains: {
		searchUrl: required("RETRIEVAL_BASE_URL"),
		searchToken: required("RETRIEVAL_INTERNAL_TOKEN"),
		memoryUrl: required("MEMORY_SERVICE_BASE_URL"),
		memorySecret: required("MEMORY_INTERNAL_SHARED_SECRET"),
	},
	modelConfigUrl: required("MODEL_CONFIG_URL"),
	release: process.env.DEPLOYMENT_RELEASE ?? "unversioned-local",
	resolveSources: resolver.resolve,
});
const bundlePath = fileURLToPath(new URL("./workflows.cjs", import.meta.url));
const workflows = await Worker.create({
	connection,
	namespace,
	taskQueue: AGENT_WORKFLOW_QUEUE,
	...(existsSync(bundlePath)
		? { workflowBundle: { codePath: bundlePath } }
		: { workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)) }),
});
const models = await Worker.create({
	connection,
	namespace,
	taskQueue: AGENT_MODEL_QUEUE,
	activities: {
		prepareStage: activities.prepareStage,
		modelTurn: activities.modelTurn,
		completeTurn: activities.completeTurn,
		completeStage: activities.completeStage,
		finalizeAnswer: activities.finalizeAnswer,
		finalizeFailure: activities.finalizeFailure,
	},
	maxConcurrentActivityTaskExecutions: 16,
	shutdownGraceTime: "5 minutes",
});
const tools = await Worker.create({
	connection,
	namespace,
	taskQueue: AGENT_TOOL_QUEUE,
	activities: { executeTool: activities.executeTool },
	maxConcurrentActivityTaskExecutions: 32,
	shutdownGraceTime: "2 minutes",
});
let stopping = false;
const health = createServer((req, res) => {
	const ready = !stopping && [workflows, models, tools].every((w) => w.getState() === "RUNNING");
	res.statusCode = req.url === "/healthz" ? 200 : req.url === "/readyz" ? (ready ? 200 : 503) : 404;
	res.end();
});
health.listen(Number(process.env.AGENT_WORKER_PORT ?? 8000), process.env.HOST ?? "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		if (stopping) {
			return;
		}
		stopping = true;
		workflows.shutdown();
		models.shutdown();
		tools.shutdown();
	});
}
try {
	await Promise.all([workflows.run(), models.run(), tools.run()]);
} finally {
	health.close();
	await resolver.close();
	await telemetry.shutdown();
	await connection.close();
}
