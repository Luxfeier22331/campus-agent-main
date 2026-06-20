import { createServer } from "node:http";

import { buildOtelIngestGatewayConfig } from "./config.ts";
import { createOtelIngestGatewayHandler } from "./http.ts";

const config = buildOtelIngestGatewayConfig(process.env);
const handler = createOtelIngestGatewayHandler(config);

const server = createServer(async (incoming, outgoing) => {
	const body =
		incoming.method === "GET" || incoming.method === "HEAD"
			? undefined
			: await readIncomingBody(incoming);
	const request = new Request(`http://${incoming.headers.host ?? "otel-ingest"}${incoming.url}`, {
		body: body ? new Uint8Array(body) : undefined,
		headers: incoming.headers as HeadersInit,
		method: incoming.method,
	});
	const response = await handler(request);
	outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
	outgoing.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(config.port, config.host, () => {
	console.log(`otel-ingest-gateway listening on ${config.host}:${config.port}`);
});

async function readIncomingBody(
	incoming: AsyncIterable<Buffer | string | Uint8Array>,
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of incoming) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
