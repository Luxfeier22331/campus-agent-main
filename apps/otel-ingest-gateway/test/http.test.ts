import { describe, expect, it, vi } from "vitest";

import { buildOtelIngestGatewayConfig, createOtelIngestGatewayHandler } from "../src/index.ts";

describe("otel-ingest-gateway", () => {
	it("fails closed when runtime config is incomplete", () => {
		expect(() => buildOtelIngestGatewayConfig({})).toThrow("OTEL_INGEST_SHARED_SECRET is required");
		expect(() =>
			buildOtelIngestGatewayConfig({
				OTEL_INGEST_SHARED_SECRET: "secret",
			}),
		).toThrow("OTEL_INGEST_COLLECTOR_HTTP_ENDPOINT is required");
	});

	it("accepts authenticated trace and log payloads and forwards them to the collector", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const handler = createOtelIngestGatewayHandler({
			collectorHttpEndpoint: "http://otel-collector:4318",
			fetchImplementation,
			maxBodyBytes: 1024,
			sharedSecret: "secret",
		});

		for (const path of ["/v1/traces", "/v1/logs"]) {
			const response = await handler(
				new Request(`http://gateway${path}`, {
					body: JSON.stringify({ resourceSpans: [] }),
					headers: {
						authorization: "Bearer secret",
						"content-type": "application/json",
						traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
					},
					method: "POST",
				}),
			);

			expect(response.status).toBe(200);
		}

		expect(fetchImplementation.mock.calls[0][0]).toBe("http://otel-collector:4318/v1/traces");
		expect(fetchImplementation.mock.calls[1][0]).toBe("http://otel-collector:4318/v1/logs");
		for (const call of fetchImplementation.mock.calls) {
			const init = call[1] as RequestInit;
			expect(init.method).toBe("POST");
			expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(
				JSON.stringify({ resourceSpans: [] }),
			);
			const headers = init.headers as Headers;
			expect(headers.get("content-type")).toBe("application/json");
			expect(headers.get("traceparent")).toBe(
				"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
			);
		}
	});

	it("rejects anonymous, oversized, metric and unknown requests before collector forwarding", async () => {
		const fetchImplementation = vi.fn();
		const handler = createOtelIngestGatewayHandler({
			collectorHttpEndpoint: "http://otel-collector:4318",
			fetchImplementation,
			maxBodyBytes: 4,
			sharedSecret: "secret",
		});

		const anonymous = await handler(new Request("http://gateway/v1/traces", { method: "POST" }));
		expect(anonymous.status).toBe(401);

		const metrics = await handler(
			new Request("http://gateway/v1/metrics", {
				body: "{}",
				headers: { authorization: "Bearer secret", "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(metrics.status).toBe(404);

		const oversized = await handler(
			new Request("http://gateway/v1/logs", {
				body: "12345",
				headers: { authorization: "Bearer secret", "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(oversized.status).toBe(413);

		const wrongMethod = await handler(
			new Request("http://gateway/v1/traces", {
				headers: { authorization: "Bearer secret" },
				method: "GET",
			}),
		);
		expect(wrongMethod.status).toBe(405);
		expect(fetchImplementation).not.toHaveBeenCalled();
	});
});
