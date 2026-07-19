import { createServer } from "node:http";
import { createAgentRuntimeHandler } from "./http-server.ts";
import { nodeClientDisconnectSignal } from "./node-http.ts";
import { createPrimaryAgentRuntime } from "./primary-agent.ts";
import {
	createRequestScopedOpenAIAgentsRunner,
	createRequestScopedStreamingOpenAIAgentsRunner,
} from "./provider-config.ts";
import { runWithExtractedTraceContext, startAgentRuntimeTelemetry } from "./telemetry.ts";
import { loadToolCatalog } from "./tool-catalog.ts";
import { createExecutionControlToolExecutor } from "./tool-executor.ts";

const port = Number.parseInt(process.env.AGENT_RUNTIME_PORT ?? "27062", 10);
const host = process.env.AGENT_RUNTIME_HOST ?? "127.0.0.1";
const executionAgentRuntimeSharedSecret = process.env.EXECUTION_AGENT_RUNTIME_SHARED_SECRET ?? "";
const catalogPath = process.env.AGENT_RUNTIME_TOOL_REGISTRY_PATH ?? "configs/runtime/tools.v5.json";
const executionControlBaseUrl =
	process.env.AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL ?? "http://127.0.0.1:27051";

const telemetry = (() => {
	try {
		return startAgentRuntimeTelemetry();
	} catch (error) {
		console.error("agent-runtime telemetry initialization failed", error);
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
	sharedSecret: executionAgentRuntimeSharedSecret,
	runtime,
});

const server = createServer(async (request, response) => {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const url = `http://${request.headers.host ?? "agent-runtime"}${request.url ?? "/"}`;
	const webRequest = new Request(url, {
		method: request.method,
		headers: request.headers as HeadersInit,
		body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
		signal: nodeClientDisconnectSignal(request, response),
	});
	const webResponse = await runWithExtractedTraceContext(webRequest.headers, () =>
		handler(webRequest),
	);
	response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
	if (!webResponse.body) {
		response.end();
		return;
	}
	const reader = webResponse.body.getReader();
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			response.write(Buffer.from(chunk.value));
		}
		response.end();
	} catch (error) {
		response.destroy(error instanceof Error ? error : new Error(String(error)));
	} finally {
		reader.releaseLock();
	}
});

server.listen(port, host, () => {
	console.log(`agent-runtime listening on ${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		server.close(() => {
			void telemetry.shutdown().finally(() => process.exit(0));
		});
	});
}
