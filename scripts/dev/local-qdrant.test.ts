import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { it, type TestContext } from "node:test";

import { resolveLocalQdrantConnection } from "./local-qdrant";
import type { captureCommandResult } from "./process";

function containerCapture(input: {
	apiKey?: string;
	port: number;
	running?: boolean;
}): typeof captureCommandResult {
	return () => ({
		status: 0,
		stderr: "",
		stdout: JSON.stringify([
			{
				Config: {
					Env: [
						"QDRANT__SERVICE__READ_ONLY_API_KEY=fixture-read-only",
						...(input.apiKey ? [`QDRANT__SERVICE__API_KEY=${input.apiKey}`] : []),
					],
				},
				NetworkSettings: {
					Ports: { "6333/tcp": [{ HostIp: "127.0.0.1", HostPort: String(input.port) }] },
				},
				State: { Running: input.running ?? true },
			},
		]),
		timedOut: false,
	});
}

async function startQdrantFixture(t: TestContext) {
	const requests: { key: string; method: string | undefined; url: string | undefined }[] = [];
	const apiKey = "fixture-writer=key";
	const server = createServer((request, response) => {
		requests.push({
			key: String(request.headers["api-key"]),
			method: request.method,
			url: request.url,
		});
		response.writeHead(request.headers["api-key"] === apiKey ? 200 : 401);
		response.end(JSON.stringify({ result: { collections: [] } }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			}),
	);
	return { apiKey, port: (server.address() as AddressInfo).port, requests };
}

it("resolves the running container's writer key and published port and authenticates with them", async (t) => {
	const fixture = await startQdrantFixture(t);
	const capture = t.mock.fn(containerCapture(fixture));
	const connection = await resolveLocalQdrantConnection(capture);
	assert.deepEqual(capture.mock.calls[0]?.arguments, [
		"docker",
		["inspect", "campus-agent-local-qdrant-qdrant-1"],
	]);
	assert.deepEqual(connection, {
		apiKey: fixture.apiKey,
		readOnlyApiKey: "fixture-read-only",
		url: `http://127.0.0.1:${fixture.port}`,
	});
	assert.deepEqual(fixture.requests, [{ key: fixture.apiKey, method: "GET", url: "/collections" }]);
});

it("rejects a key that receives 401 instead of completing initialization", async (t) => {
	const fixture = await startQdrantFixture(t);
	await assert.rejects(
		resolveLocalQdrantConnection(containerCapture({ ...fixture, apiKey: "stale-writer" })),
		/credential check failed: HTTP 401/u,
	);
});

it("requires a writer key rather than substituting the read-only key", async () => {
	await assert.rejects(
		resolveLocalQdrantConnection(containerCapture({ port: 6333 })),
		/does not configure QDRANT__SERVICE__API_KEY/u,
	);
});

it("reports missing and stopped Qdrant containers without generating credentials", async () => {
	await assert.rejects(
		resolveLocalQdrantConnection(() => ({
			status: 1,
			stderr: "No such container",
			stdout: "",
			timedOut: false,
		})),
		/Cannot inspect local Qdrant/u,
	);
	await assert.rejects(
		resolveLocalQdrantConnection(containerCapture({ port: 6333, running: false })),
		/not running/u,
	);
});
