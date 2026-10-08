import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createAgentRuntimeNodeServer } from "../src/node-http.ts";
import {
	createRuntimeMetricsServer,
	drainRuntimeServer,
	RuntimeLifecycle,
} from "../src/runtime-lifecycle.ts";
import { deferred } from "./helpers/deferred.ts";

describe("runtime execution lifecycle", () => {
	it("exposes an idle zero gauge and keeps health requests outside execution counts", async () => {
		const state = new RuntimeLifecycle();
		const server = createRuntimeMetricsServer(state);
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			expect(await (await fetch(`${url}/metrics`)).text()).toContain(
				"agent_runtime_active_requests 0\n",
			);
			expect((await fetch(`${url}/healthz`)).status).toBe(404);
			expect(state.activeRequests).toBe(0);
		} finally {
			server.closeAllConnections();
			server.close();
		}
	});

	it.each(["complete", "disconnect", "error"])(
		"counts a stream until transport %s",
		async (outcome) => {
			const state = new RuntimeLifecycle();
			const terminal = deferred<void>();
			const server = createAgentRuntimeNodeServer({
				lifecycle: state,
				sharedSecret: "secret",
				async handler(_request, accepted) {
					accepted?.();
					return new Response(
						new ReadableStream<Uint8Array>({
							async start(controller) {
								controller.enqueue(new TextEncoder().encode("first"));
								await terminal.promise;
								if (outcome === "error") {
									controller.error(new Error("stream failed"));
								} else if (outcome === "complete") {
									controller.close();
								}
							},
						}),
					);
				},
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			const abort = new AbortController();
			try {
				const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
					signal: abort.signal,
				});
				expect(state.activeRequests).toBe(1);
				const body = response.text().catch(() => "aborted");
				const drain = drainRuntimeServer(server, state, 1000);
				if (outcome === "disconnect") {
					abort.abort();
				}
				terminal.resolve();
				const received = await body;
				if (outcome === "complete") {
					expect(received).toBe("first");
				}
				expect(await drain).toBe(true);
				await expect.poll(() => state.activeRequests).toBe(0);
				expect(state.metrics()).toContain("agent_runtime_active_requests 0\n");
			} finally {
				terminal.resolve();
				server.closeAllConnections();
				server.close();
			}
		},
	);

	it.each([false, true])("drains accepted HTTP work with bounded timeout=%s", async (expires) => {
		const state = new RuntimeLifecycle();
		const accepted = deferred<void>();
		const terminal = deferred<void>();
		const server = createAgentRuntimeNodeServer({
			lifecycle: state,
			sharedSecret: "secret",
			async handler(_request, onAccepted) {
				onAccepted?.();
				accepted.resolve();
				await terminal.promise;
				return new Response("done");
			},
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const pending = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
			.then((r) => r.text())
			.catch(() => "closed");
		await accepted.promise;
		const drain = drainRuntimeServer(server, state, expires ? 30 : 1000);
		expect(state.draining).toBe(true);
		expect(state.activeRequests).toBe(1);
		if (!expires) {
			terminal.resolve();
		}
		expect(await drain).toBe(!expires);
		terminal.resolve();
		expect(await pending).toBe(expires ? "closed" : "done");
		await expect.poll(() => state.activeRequests).toBe(0);
	});
});
