import { EventEmitter } from "node:events";
import { request as nodeRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowOperationRuntime } from "../src/agent-run-contract.ts";
import { agentRunStreamResponse } from "../src/http-response.ts";
import {
	AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES,
	createAgentRuntimeNodeServer,
	nodeClientDisconnectSignal,
	writeNodeResponse,
} from "../src/node-http.ts";

describe("agent runtime node HTTP bridge", () => {
	it("does not abort the web request signal when the incoming request closes normally", () => {
		const request = new EventEmitter();
		const response = new EventEmitter();

		const signal = nodeClientDisconnectSignal(request, response);

		expect(signal.aborted).toBe(false);

		request.emit("close");

		expect(signal.aborted).toBe(false);
	});

	it("aborts the web request signal when the incoming request is aborted", () => {
		const request = new EventEmitter();
		const response = new EventEmitter();

		const signal = nodeClientDisconnectSignal(request, response);

		request.emit("aborted");

		expect(signal.aborted).toBe(true);
	});

	it("aborts the web request signal when the response closes before completion", () => {
		const request = new EventEmitter();
		const response = new EventEmitter();

		const signal = nodeClientDisconnectSignal(request, response);

		response.emit("close");

		expect(signal.aborted).toBe(true);
	});
});

describe("agent runtime node HTTP server", () => {
	it("waits for drain before pulling another response chunk", async () => {
		const response = fakeServerResponse();
		const chunks: Uint8Array[] = [new Uint8Array([1]), new Uint8Array([2])];
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulls += 1;
					const chunk = chunks.shift();
					if (chunk) {
						controller.enqueue(chunk);
					} else {
						controller.close();
					}
				},
			},
			{ highWaterMark: 0 },
		);
		const writePromise = writeNodeResponse(response, new Response(body));

		await vi.waitFor(() => expect(response.write).toHaveBeenCalledTimes(1));
		expect(pulls).toBe(1);
		expect(response.end).not.toHaveBeenCalled();

		response.emit("drain");
		await writePromise;
		expect(response.write).toHaveBeenCalledTimes(2);
		expect(response.end).toHaveBeenCalledOnce();
	});

	it("cancels the upstream response body when a slow client closes", async () => {
		const response = fakeServerResponse();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					controller.enqueue(new Uint8Array([1]));
				},
				cancel,
			},
			{ highWaterMark: 0 },
		);
		const writePromise = writeNodeResponse(response, new Response(body));

		await Promise.resolve();
		await Promise.resolve();
		response.destroyed = true;
		response.emit("close");
		await writePromise;

		expect(cancel).toHaveBeenCalledOnce();
		expect(response.end).not.toHaveBeenCalled();
	});

	it("closes the agent event iterator when the Node streaming client disconnects", async () => {
		const response = fakeServerResponse();
		let nextCalls = 0;
		const returnIterator = vi.fn(async () => ({ done: true as const, value: undefined }));
		const events = {
			[Symbol.asyncIterator]() {
				return {
					next: async () => {
						nextCalls += 1;
						if (nextCalls === 1) {
							return {
								done: false as const,
								value: {
									event: "answer_delta" as const,
									data: { delta: "A", provisional: true },
								},
							};
						}
						return new Promise<never>(() => undefined);
					},
					return: returnIterator,
				};
			},
		} as ReturnType<WorkflowOperationRuntime["stream"]>;
		const writePromise = writeNodeResponse(
			response,
			agentRunStreamResponse(events, { runtimeRelease: "test-release" }),
		);

		await vi.waitFor(() => expect(response.write).toHaveBeenCalledOnce());
		response.destroyed = true;
		response.emit("close");
		await writePromise;

		expect(returnIterator).toHaveBeenCalledOnce();
		expect(response.end).not.toHaveBeenCalled();
	});

	it("rejects an unauthorized protected request before inspecting its oversized body", async () => {
		const handler = vi.fn(async () => new Response(null, { status: 204 }));
		await withNodeServer(handler, async (port) => {
			const response = await sendNodeRequest(port, {
				headers: {
					authorization: "Bearer wrong-secret",
					"content-length": String(AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES + 1),
				},
				method: "POST",
				path: "/internal/agent-requests",
			});

			expect(response.status).toBe(401);
			expect(JSON.parse(response.body)).toMatchObject({ error: { code: "unauthorized" } });
			expect(handler).not.toHaveBeenCalled();
		});
	});

	it("rejects declared and chunked bodies above the same one MiB limit", async () => {
		const handler = vi.fn(async () => new Response(null, { status: 204 }));
		await withNodeServer(handler, async (port) => {
			const declared = await sendNodeRequest(port, {
				headers: {
					authorization: "Bearer test-secret",
					"content-length": String(AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES + 1),
				},
				method: "POST",
				path: "/internal/agent-requests",
			});
			expect(declared.status).toBe(413);

			const chunked = await sendNodeRequest(port, {
				body: Buffer.alloc(AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES + 1, "a"),
				chunked: true,
				headers: { authorization: "Bearer test-secret" },
				method: "POST",
				path: "/internal/agent-requests/stream",
			});
			expect(chunked.status).toBe(413);
			expect(JSON.parse(chunked.body)).toMatchObject({
				error: { code: "payload_too_large" },
			});
			expect(handler).not.toHaveBeenCalled();
		});
	});

	it("never attaches a body to GET or HEAD requests", async () => {
		const observed: Array<{ body: ReadableStream<Uint8Array> | null; method: string }> = [];
		await withNodeServer(
			async (request) => {
				observed.push({ body: request.body, method: request.method });
				return new Response("ok");
			},
			async (port) => {
				const getResponse = await sendNodeRequest(port, {
					body: "unexpected",
					method: "GET",
					path: "/healthz",
				});
				const headResponse = await sendNodeRequest(port, {
					body: "unexpected",
					method: "HEAD",
					path: "/healthz",
				});

				expect(getResponse.status).toBe(200);
				expect(headResponse.status).toBe(200);
				expect(observed).toEqual([
					{ body: null, method: "GET" },
					{ body: null, method: "HEAD" },
				]);
			},
		);
	});

	it("accepts a protected body at the one MiB boundary", async () => {
		await withNodeServer(
			async (request) => new Response(String((await request.arrayBuffer()).byteLength)),
			async (port) => {
				const response = await sendNodeRequest(port, {
					body: Buffer.alloc(AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES, "a"),
					headers: { authorization: "Bearer test-secret" },
					method: "POST",
					path: "/internal/agent-requests",
				});

				expect(response.status).toBe(200);
				expect(response.body).toBe(String(AGENT_RUNTIME_MAX_REQUEST_BODY_BYTES));
			},
		);
	});

	it("contains handler rejection to one request and keeps serving", async () => {
		const onError = vi.fn();
		await withNodeServer(
			async (request) => {
				if (new URL(request.url).pathname === "/healthz") {
					return new Response("ok");
				}
				throw new Error("private failure detail");
			},
			async (port) => {
				const failed = await sendNodeRequest(port, {
					body: "{}",
					headers: { authorization: "Bearer test-secret" },
					method: "POST",
					path: "/internal/agent-requests",
				});
				expect(failed.status).toBe(500);
				expect(failed.body).not.toContain("private failure detail");

				const healthy = await sendNodeRequest(port, { method: "GET", path: "/healthz" });
				expect(healthy).toMatchObject({ body: "ok", status: 200 });
				expect(onError).toHaveBeenCalledOnce();
			},
			onError,
		);
	});
});

function fakeServerResponse() {
	const response = new EventEmitter() as EventEmitter & {
		destroyed: boolean;
		end: ReturnType<typeof vi.fn>;
		write: ReturnType<typeof vi.fn>;
		writeHead: ReturnType<typeof vi.fn>;
	};
	response.destroyed = false;
	response.writeHead = vi.fn();
	response.write = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
	response.end = vi.fn();
	return response as unknown as import("node:http").ServerResponse;
}

async function withNodeServer(
	handler: (request: Request) => Promise<Response>,
	callback: (port: number) => Promise<void>,
	onError: (error: unknown) => void = () => undefined,
): Promise<void> {
	const server = createAgentRuntimeNodeServer({ handler, onError, sharedSecret: "test-secret" });
	await listenOnRandomPort(server);
	const address = server.address() as AddressInfo;
	try {
		await callback(address.port);
	} finally {
		await closeServer(server);
	}
}

function listenOnRandomPort(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
		server.closeAllConnections();
	});
}

function sendNodeRequest(
	port: number,
	input: {
		body?: Buffer | string;
		chunked?: boolean;
		headers?: Record<string, string>;
		method: string;
		path: string;
	},
): Promise<{ body: string; status: number }> {
	return new Promise((resolve, reject) => {
		const body = input.body === undefined ? undefined : Buffer.from(input.body);
		const headers = { ...input.headers };
		if (body && !input.chunked && headers["content-length"] === undefined) {
			headers["content-length"] = String(body.length);
		}
		const request = nodeRequest(
			{
				agent: false,
				headers,
				host: "127.0.0.1",
				method: input.method,
				path: input.path,
				port,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({
						body: Buffer.concat(chunks).toString("utf8"),
						status: response.statusCode ?? 0,
					}),
				);
			},
		);
		request.on("error", reject);
		request.end(body);
	});
}
