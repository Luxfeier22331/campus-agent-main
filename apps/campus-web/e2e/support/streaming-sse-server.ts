import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface StreamingSseChunk {
	body: string;
	delayMs?: number;
}

export interface StreamingSseServer {
	readonly requestBodies: readonly string[];
	readonly url: string;
	close(): Promise<void>;
}

export async function startStreamingSseServer(
	createChunks: (requestBody: string) => readonly StreamingSseChunk[],
): Promise<StreamingSseServer> {
	const requestBodies: string[] = [];
	const activeResponses = new Set<ServerResponse>();
	const server = createServer((request, response) => {
		void handleRequest(request, response).catch(() => {
			if (!response.headersSent) {
				response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
			}
			response.end();
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("Streaming SSE server did not expose a TCP address.");
	}

	async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (request.method === "OPTIONS") {
			writeCorsHeaders(request, response);
			response.writeHead(204);
			response.end();
			return;
		}
		if (request.method !== "POST" || request.url !== "/stream") {
			response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			response.end("Not found");
			return;
		}

		const requestBody = await readRequestBody(request);
		requestBodies.push(requestBody);
		activeResponses.add(response);
		let closed = false;
		const markClosed = () => {
			closed = true;
		};
		request.once("aborted", markClosed);
		response.once("close", markClosed);

		writeCorsHeaders(request, response);
		response.writeHead(200, {
			"cache-control": "no-store",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		});
		response.flushHeaders();

		try {
			for (const chunk of createChunks(requestBody)) {
				if (chunk.delayMs && chunk.delayMs > 0) {
					await wait(chunk.delayMs);
				}
				if (closed || response.destroyed || response.writableEnded) {
					return;
				}
				response.write(chunk.body);
			}
			if (closed || response.destroyed || response.writableEnded) {
				return;
			}
			response.end();
		} finally {
			activeResponses.delete(response);
			request.removeListener("aborted", markClosed);
			response.removeListener("close", markClosed);
		}
	}

	return {
		get requestBodies() {
			return requestBodies;
		},
		url: `http://127.0.0.1:${(address as AddressInfo).port}`,
		async close() {
			for (const response of activeResponses) {
				response.destroy();
			}
			await closeServer(server);
		},
	};
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function writeCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
	const origin = request.headers.origin;
	if (typeof origin === "string" && origin.length > 0) {
		response.setHeader("access-control-allow-credentials", "true");
		response.setHeader("access-control-allow-origin", origin);
		response.setHeader("vary", "Origin");
	} else {
		response.setHeader("access-control-allow-origin", "*");
	}
	response.setHeader("access-control-allow-headers", "content-type, accept");
	response.setHeader("access-control-allow-methods", "OPTIONS, POST");
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	if (!server.listening) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}
