import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const CHATKIT_DEV_PROXY_TARGET = "http://127.0.0.1:27031/api/chatkit";

export function createChatKitDevProxyPlugin(): Plugin {
	return {
		configureServer(server) {
			server.middlewares.use("/api/chatkit", (request, response) => {
				void proxyChatKitDevRequest(request, response);
			});
		},
		name: "campus-web:chatkit-dev-proxy",
	};
}

async function proxyChatKitDevRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	if (request.method !== "POST") {
		writeJson(response, 404, {
			error: { code: "not_found", message: "这个接口不存在。" },
		});
		return;
	}

	try {
		const upstreamResponse = await fetch(CHATKIT_DEV_PROXY_TARGET, {
			body: new Uint8Array(await readRequestBody(request)),
			headers: createForwardedHeaders(request),
			method: "POST",
		});
		response.statusCode = upstreamResponse.status;
		response.statusMessage = upstreamResponse.statusText;
		for (const [name, value] of upstreamResponse.headers) {
			if (name.toLowerCase() !== "set-cookie") {
				response.setHeader(name, value);
			}
		}
		response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
	} catch {
		writeJson(response, 503, {
			error: { code: "dependency_not_ready", message: "服务暂不可用，请稍后再试。" },
		});
	}
}

function createForwardedHeaders(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const name of ["accept", "content-type", "cookie", "idempotency-key", "x-trace-id"]) {
		const value = request.headers[name];
		if (Array.isArray(value)) {
			headers.set(name, value.join(", "));
		} else if (value) {
			headers.set(name, value);
		}
	}
	return headers;
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
	response.statusCode = statusCode;
	response.setHeader("cache-control", "no-store");
	response.setHeader("content-type", "application/json; charset=utf-8");
	response.end(JSON.stringify(payload));
}
