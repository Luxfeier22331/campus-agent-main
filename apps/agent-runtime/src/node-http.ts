import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { authorizedBearerValue, jsonResponse } from "./http-response.ts";

export const AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES = 1 << 20;

const BODY_ROUTES = new Set(["/internal/agent-runs", "/internal/agent-runs/stream"]);

export interface AgentRuntimeNodeServerOptions {
	handler(request: Request): Promise<Response>;
	onError?(error: unknown): void;
	sharedSecret: string;
}

interface AbortEventSource {
	once(eventName: string, listener: () => void): unknown;
}

export function nodeClientDisconnectSignal(
	request: IncomingMessage | AbortEventSource,
	response: ServerResponse | AbortEventSource,
): AbortSignal {
	const controller = new AbortController();
	const abort = () => {
		if (!controller.signal.aborted) {
			controller.abort();
		}
	};
	request.once("aborted", abort);
	response.once("close", abort);
	return controller.signal;
}

export function createAgentRuntimeNodeServer(options: AgentRuntimeNodeServerOptions): Server {
	return createServer((request, response) => {
		void serveAgentRuntimeNodeRequest(request, response, options).catch((error) => {
			try {
				options.onError?.(error);
			} catch {
				// Error reporting must not escape the per-request boundary.
			}
			if (response.destroyed) {
				return;
			}
			if (response.headersSent) {
				response.destroy();
				return;
			}
			void writeNodeResponse(
				response,
				jsonResponse(500, {
					error: {
						code: "internal_error",
						message: "Agent runtime request failed.",
					},
				}),
			).catch(() => response.destroy());
		});
	});
}

async function serveAgentRuntimeNodeRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: AgentRuntimeNodeServerOptions,
): Promise<void> {
	const requestURL = new URL(request.url ?? "/", "http://agent-runtime");
	const method = request.method ?? "GET";
	const acceptsBody = method === "POST" && BODY_ROUTES.has(requestURL.pathname);
	let body: Buffer | undefined;

	if (acceptsBody) {
		const authorization = singleHeaderValue(request.headers.authorization);
		if (!authorizedBearerValue(authorization ?? "", options.sharedSecret)) {
			closeConnectionAfterResponse(response);
			await writeNodeResponse(
				response,
				jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				}),
			);
			return;
		}

		const contentLength = parseContentLength(request.headers);
		if (contentLength.kind === "invalid") {
			closeConnectionAfterResponse(response);
			await writeNodeResponse(
				response,
				jsonResponse(400, {
					error: {
						code: "invalid_body",
						message: "Content-Length must be a non-negative integer.",
					},
				}),
			);
			return;
		}
		if (
			contentLength.kind === "present" &&
			contentLength.value > AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES
		) {
			closeConnectionAfterResponse(response);
			await writePayloadTooLarge(response);
			return;
		}

		const read = await readRequestBody(request, AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES);
		if (read.kind === "too_large") {
			closeConnectionAfterResponse(response);
			await writePayloadTooLarge(response);
			return;
		}
		body = read.body.length > 0 ? read.body : undefined;
	}

	if (!acceptsBody && requestMayHaveBody(request.headers)) {
		closeConnectionAfterResponse(response);
	}
	const signal = nodeClientDisconnectSignal(request, response);
	const webBody = body ? Uint8Array.from(body) : undefined;
	const webRequest = new Request(requestURL, {
		method,
		headers: requestHeaders(request.headers),
		body: method === "GET" || method === "HEAD" ? undefined : webBody,
		signal,
	});
	const webResponse = await options.handler(webRequest);
	await writeNodeResponse(response, webResponse);
}

function parseContentLength(
	headers: IncomingHttpHeaders,
): { kind: "absent" | "invalid" } | { kind: "present"; value: number } {
	const raw = singleHeaderValue(headers["content-length"]);
	if (raw === undefined) {
		return { kind: "absent" };
	}
	if (!/^\d+$/u.test(raw)) {
		return { kind: "invalid" };
	}
	const value = Number(raw);
	return Number.isSafeInteger(value) ? { kind: "present", value } : { kind: "invalid" };
}

function readRequestBody(
	request: IncomingMessage,
	limit: number,
): Promise<{ body: Buffer; kind: "body" } | { kind: "too_large" }> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let settled = false;
		const cleanup = () => {
			request.off("aborted", onAborted);
			request.off("data", onData);
			request.off("end", onEnd);
			request.off("error", onError);
		};
		const settle = (result: { body: Buffer; kind: "body" } | { kind: "too_large" }) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(result);
		};
		const onAborted = () => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(new Error("Agent runtime request body was aborted."));
		};
		const onData = (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			total += buffer.length;
			if (total > limit) {
				request.pause();
				settle({ kind: "too_large" });
				return;
			}
			chunks.push(buffer);
		};
		const onEnd = () => settle({ body: Buffer.concat(chunks, total), kind: "body" });
		const onError = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};

		request.on("aborted", onAborted);
		request.on("data", onData);
		request.on("end", onEnd);
		request.on("error", onError);
	});
}

function requestHeaders(headers: IncomingHttpHeaders): Headers {
	const result = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				result.append(name, item);
			}
		} else if (value !== undefined) {
			result.set(name, value);
		}
	}
	return result;
}

function requestMayHaveBody(headers: IncomingHttpHeaders): boolean {
	const contentLength = singleHeaderValue(headers["content-length"]);
	return contentLength !== undefined || headers["transfer-encoding"] !== undefined;
}

function closeConnectionAfterResponse(response: ServerResponse): void {
	response.shouldKeepAlive = false;
	response.setHeader("connection", "close");
}

async function writePayloadTooLarge(response: ServerResponse): Promise<void> {
	await writeNodeResponse(
		response,
		jsonResponse(413, {
			error: {
				code: "payload_too_large",
				message: `Request body must not exceed ${AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES} bytes.`,
			},
		}),
	);
}

export async function writeNodeResponse(
	response: ServerResponse,
	webResponse: Response,
): Promise<void> {
	response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
	if (!webResponse.body) {
		response.end();
		return;
	}
	const reader = webResponse.body.getReader();
	let completed = false;
	try {
		for (;;) {
			const result = await readResponseChunkOrClose(reader, response);
			if (result.kind === "closed") {
				await cancelResponseReader(reader);
				return;
			}
			if (result.chunk.done) {
				break;
			}
			if (!response.write(Buffer.from(result.chunk.value))) {
				const drained = await waitForNodeResponseDrain(response);
				if (!drained) {
					await cancelResponseReader(reader);
					return;
				}
			}
		}
		if (!response.destroyed) {
			response.end();
			completed = true;
		}
	} finally {
		if (!completed) {
			await cancelResponseReader(reader);
		}
		reader.releaseLock();
	}
}

function readResponseChunkOrClose(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	response: ServerResponse,
): Promise<{ chunk: ReadableStreamReadResult<Uint8Array>; kind: "chunk" } | { kind: "closed" }> {
	if (response.destroyed) {
		return Promise.resolve({ kind: "closed" });
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			response.off("close", onClose);
			response.off("error", onError);
		};
		const settle = (
			result: { chunk: ReadableStreamReadResult<Uint8Array>; kind: "chunk" } | { kind: "closed" },
		) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(result);
		};
		const fail = (error: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};
		const onClose = () => settle({ kind: "closed" });
		const onError = (error: Error) => fail(error);

		response.once("close", onClose);
		response.once("error", onError);
		reader.read().then(
			(chunk) => settle({ chunk, kind: "chunk" }),
			(error) => fail(error),
		);
	});
}

function waitForNodeResponseDrain(response: ServerResponse): Promise<boolean> {
	if (response.destroyed) {
		return Promise.resolve(false);
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			response.off("close", onClose);
			response.off("drain", onDrain);
			response.off("error", onError);
		};
		const settle = (drained: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(drained);
		};
		const onClose = () => settle(false);
		const onDrain = () => settle(true);
		const onError = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};

		response.once("close", onClose);
		response.once("drain", onDrain);
		response.once("error", onError);
	});
}

async function cancelResponseReader(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
	try {
		await reader.cancel("Node HTTP response closed before the web response completed.");
	} catch {
		// The transport is already closed; cancellation is best-effort cleanup.
	}
}

function singleHeaderValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}
