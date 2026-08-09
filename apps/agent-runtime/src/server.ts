import { createAgentRuntimeHandler } from "./http-server.ts";
import { createAgentRuntimeNodeServer } from "./node-http.ts";
import { createPrimaryAgentRuntime } from "./primary-agent.ts";
import {
	createRequestScopedOpenAIAgentsRunner,
	createRequestScopedStreamingOpenAIAgentsRunner,
} from "./provider-config.ts";
import { logAgentRuntimeEvent, safeAgentRuntimeErrorCode } from "./safe-logging.ts";
import { runWithExtractedTraceContext, startAgentRuntimeTelemetry } from "./telemetry.ts";
import { loadToolCatalog } from "./tool-catalog.ts";
import { createExecutionControlToolExecutor } from "./tool-executor.ts";

const port = 27062;
const host = "0.0.0.0";
const executionAgentRuntimeSharedSecret = process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET ?? "";
const catalogPath = "configs/runtime/tools.v6.json";
const deploymentRelease = requiredDeploymentRelease(
	process.env.DEPLOYMENT_ENVIRONMENT,
	process.env.DEPLOYMENT_RELEASE,
);
const executionControlBaseUrl =
	process.env.AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL ?? "http://127.0.0.1:27051";

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

const catalog = loadToolCatalog(catalogPath, { runtimeRelease: deploymentRelease });
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
	sharedSecret: executionAgentRuntimeSharedSecret,
	runtime,
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
