import { createServer } from "node:http";
import { createAgentRuntimeHandler } from "./http-server.ts";
import { nodeClientDisconnectSignal } from "./node-http.ts";
import { createPrimaryAgentRuntime } from "./primary-agent.ts";
import { createRequestScopedOpenAIAgentsRunner } from "./provider-config.ts";
import { loadToolCatalog } from "./tool-catalog.ts";
import { createExecutionControlToolExecutor } from "./tool-executor.ts";

const port = Number.parseInt(process.env.AGENT_RUNTIME_PORT ?? "27062", 10);
const host = process.env.AGENT_RUNTIME_HOST ?? "127.0.0.1";
const sharedSecret = process.env.AGENT_RUNTIME_SHARED_SECRET ?? "";
const catalogPath =
	process.env.AGENT_RUNTIME_TOOL_CATALOG_PATH ?? "configs/runtime/tool-catalog.v1.json";
const executionControlBaseUrl =
	process.env.AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL ?? "http://127.0.0.1:27051";
const executionControlSharedSecret =
	process.env.AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET ?? "";

const catalog = loadToolCatalog(catalogPath);
const runtime = createPrimaryAgentRuntime({
	catalog,
	runner: createRequestScopedOpenAIAgentsRunner(),
	toolExecutor: createExecutionControlToolExecutor({
		baseUrl: executionControlBaseUrl,
		sharedSecret: executionControlSharedSecret,
	}),
});
const handler = createAgentRuntimeHandler({ sharedSecret, runtime });

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
	const webResponse = await handler(webRequest);
	response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
	response.end(Buffer.from(await webResponse.arrayBuffer()));
});

server.listen(port, host, () => {
	console.log(`agent-runtime listening on ${host}:${port}`);
});
