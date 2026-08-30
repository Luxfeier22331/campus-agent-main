import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentRuntimeHandler } from "./http-server.ts";
import { createAgentRuntimeNodeServer } from "./node-http.ts";
import { createPrimaryAgentRuntime } from "./primary-agent.ts";
import {
	createRequestScopedOpenAIAgentsRunner,
	createRequestScopedStreamingOpenAIAgentsRunner,
} from "./provider-config.ts";
import { logAgentRuntimeEvent, safeAgentRuntimeErrorCode } from "./safe-logging.ts";
import { exactSharedSecret, loadAgentRuntimeServerConfig } from "./server-config.ts";
import { runWithExtractedTraceContext, startAgentRuntimeTelemetry } from "./telemetry.ts";
import { loadToolCatalog } from "./tool-catalog.ts";
import { createExecutionControlToolExecutor } from "./tool-executor.ts";

const { host, port } = loadAgentRuntimeServerConfig();
const executionAgentRuntimeSharedSecret = exactSharedSecret(
	process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET,
);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalogPath = resolve(repositoryRoot, "configs/runtime/tools.v7.json");
const deploymentRelease = requiredDeploymentRelease(
	process.env.DEPLOYMENT_ENVIRONMENT,
	process.env.DEPLOYMENT_RELEASE,
);
const executionControlBaseUrl =
	process.env.AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL ?? "http://127.0.0.1:27051";
const modelConfigBaseUrl = requiredSetting("MODEL_CONFIG_URL", process.env.MODEL_CONFIG_URL);

const telemetry = (() => {
	try {
		return startAgentRuntimeTelemetry();
	} catch (error) {
		logAgentRuntimeEvent("error", "agent_runtime.telemetry_initialization", "failed", {
			error_code: safeAgentRuntimeErrorCode(error),
			source: "telemetry",
		});
		return { configured: false, shutdown: async () => undefined };
	}
})();

const catalog = loadToolCatalog(catalogPath);
const runtime = createPrimaryAgentRuntime({
	catalog,
	runner: createRequestScopedOpenAIAgentsRunner(),
	streamingRunner: createRequestScopedStreamingOpenAIAgentsRunner(),
	toolExecutor: createExecutionControlToolExecutor({
		baseUrl: executionControlBaseUrl,
		sharedSecret: executionAgentRuntimeSharedSecret,
	}),
});
const handler = createAgentRuntimeHandler({
	onStreamError: (error, context) =>
		logAgentRuntimeEvent("error", "agent_runtime.stream", "failed", {
			error_code: safeAgentRuntimeErrorCode(error),
			request_id: context.requestId,
			runtime_release: deploymentRelease,
			source: "stream",
		}),
	runtimeRelease: deploymentRelease,
	sharedSecret: executionAgentRuntimeSharedSecret,
	runtime,
	modelConfig: { baseUrl: modelConfigBaseUrl },
});

const server = createAgentRuntimeNodeServer({
	handler: (request) => runWithExtractedTraceContext(request.headers, () => handler(request)),
	onError: (error) =>
		logAgentRuntimeEvent("error", "agent_runtime.request", "failed", {
			error_code: safeAgentRuntimeErrorCode(error),
			source: "http",
		}),
	sharedSecret: executionAgentRuntimeSharedSecret,
});

server.listen(port, host, () => {
	logAgentRuntimeEvent("info", "agent_runtime.server_listening", "ready", { source: "http" });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		server.close(() => {
			void telemetry.shutdown().finally(() => process.exit(0));
		});
	});
}

function requiredDeploymentRelease(environment: string | undefined, release: string | undefined) {
	const normalizedRelease = release?.trim();
	const deployed = ["staging", "production"].includes(environment?.trim().toLowerCase() ?? "");
	if (deployed && !normalizedRelease) {
		throw new Error("DEPLOYMENT_RELEASE is required in deployed environments");
	}
	return normalizedRelease || "unversioned-local";
}

function requiredSetting(name: string, value: string | undefined): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${name} is required`);
	}
	return normalized;
}
