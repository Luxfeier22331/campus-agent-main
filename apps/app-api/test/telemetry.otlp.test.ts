// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTelemetry } from "../src/modules/telemetry";
import {
	createOtlpRuntimeEventSink,
	sanitizeRuntimeEventPayload,
} from "../src/modules/telemetry/otlp";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("app-api OTLP runtime event sink", () => {
	it("posts sanitized lifecycle events to the controlled OTLP ingest endpoint", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const sink = createOtlpRuntimeEventSink(
			{
				APP_API_ENVIRONMENT: "staging",
				APP_API_OTEL_INGEST_ENDPOINT: "https://otel-collector.example.com",
				APP_API_OTEL_INGEST_SHARED_SECRET: "ingest-secret",
			},
			{
				fetchImplementation,
				now: () => new Date("2026-06-20T12:00:00.000Z"),
			},
		);

		await sink.emit({
			answer: "raw answer must not pass",
			conversation_id: "conv_01",
			event_type: "request.accepted",
			occurred_at: "2026-06-20T12:00:00.000Z",
			prompt: "raw prompt must not pass",
			request_id: "req_01",
			status: "accepted",
			surface: "campus_web",
			trace_id: "trace_01",
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(2);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			1,
			"https://otel-collector.example.com/v1/traces",
			expect.objectContaining({
				headers: expect.objectContaining({
					authorization: "Bearer ingest-secret",
					"content-type": "application/json",
				}),
				method: "POST",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			2,
			"https://otel-collector.example.com/v1/logs",
			expect.objectContaining({
				headers: expect.objectContaining({
					authorization: "Bearer ingest-secret",
					"content-type": "application/json",
				}),
				method: "POST",
			}),
		);
		const bodies = fetchImplementation.mock.calls.map((call) => String(call[1]?.body));
		expect(bodies.join("\n")).toContain("runtime.request.accepted");
		expect(bodies.join("\n")).toContain("req_01");
		expect(bodies.join("\n")).not.toContain("raw prompt");
		expect(bodies.join("\n")).not.toContain("raw answer");
	});

	it("posts low-cardinality stage duration metrics for stage timing events", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const sink = createOtlpRuntimeEventSink(
			{
				APP_API_ENVIRONMENT: "staging",
				APP_API_OTEL_INGEST_ENDPOINT: "https://otel-collector.example.com",
				APP_API_OTEL_INGEST_SHARED_SECRET: "ingest-secret",
			},
			{
				fetchImplementation,
				now: () => new Date("2026-07-04T12:00:00.000Z"),
			},
		);

		await sink.emit({
			budget_state: "warn",
			duration_ms: 2700,
			event_type: "request.stage_timing",
			occurred_at: "2026-07-04T12:00:00.000Z",
			request_id: "req_high_cardinality",
			selected_tool: "knowledge_query",
			stage_field: "stream.browser_ttft_ms",
			status: "completed",
			surface: "campus_web",
			trace_id: "trace_high_cardinality",
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(3);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			3,
			"https://otel-collector.example.com/v1/metrics",
			expect.objectContaining({
				headers: expect.objectContaining({
					authorization: "Bearer ingest-secret",
					"content-type": "application/json",
				}),
				method: "POST",
			}),
		);
		const metricsBody = String(fetchImplementation.mock.calls[2]?.[1]?.body);
		expect(metricsBody).toContain("campus.app_api.stage_duration_ms");
		expect(metricsBody).toContain("histogram");
		expect(metricsBody).toContain("AGGREGATION_TEMPORALITY_DELTA");
		expect(metricsBody).toContain("stream.browser_ttft_ms");
		expect(metricsBody).toContain("campus_web");
		expect(metricsBody).toContain("completed");
		expect(metricsBody).toContain("knowledge_query");
		expect(metricsBody).toContain("warn");
		expect(metricsBody).toContain("2700");
		expect(metricsBody).toContain("bucketCounts");
		expect(metricsBody).not.toContain("req_high_cardinality");
		expect(metricsBody).not.toContain("trace_high_cardinality");
	});

	it("fails closed for deployed app-api environments when OTLP ingest config is missing", () => {
		expect(() =>
			createAppTelemetry({
				APP_API_ENVIRONMENT: "staging",
			}),
		).toThrow("APP_API_OTEL_INGEST_ENDPOINT is required for deployed app-api telemetry");
	});

	it("fails closed when deployed OTLP ingest config is incomplete", () => {
		expect(() =>
			createAppTelemetry({
				APP_API_ENVIRONMENT: "production",
				APP_API_OTEL_INGEST_ENDPOINT: "https://otel-collector.example.com",
			}),
		).toThrow("APP_API_OTEL_INGEST_SHARED_SECRET is required for deployed app-api telemetry");
	});

	it("keeps development and test telemetry disabled explicitly when no ingest endpoint is configured", async () => {
		const fetchImplementation = vi.fn();
		const sink = createOtlpRuntimeEventSink(
			{
				APP_API_ENVIRONMENT: "test",
			},
			{
				fetchImplementation,
			},
		);

		await sink.emit({
			event_type: "request.finalized",
			request_id: "req_01",
			status: "completed",
			surface: "campus_web",
			trace_id: "trace_01",
		});

		expect(fetchImplementation).not.toHaveBeenCalled();
	});

	it("keeps default worker fetch bound to the global runtime object", async () => {
		vi.stubGlobal("fetch", function (
			this: unknown,
			_input: RequestInfo | URL,
			_init?: RequestInit,
		): Promise<Response> {
			if (this !== globalThis) {
				throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
			}
			return Promise.resolve(new Response(null, { status: 200 }));
		} as typeof fetch);
		const sink = createOtlpRuntimeEventSink({
			APP_API_ENVIRONMENT: "test",
			APP_API_OTEL_INGEST_ENDPOINT: "https://otel-ingest.example.com",
			APP_API_OTEL_INGEST_SHARED_SECRET: "ingest-secret",
		});

		await expect(
			sink.emit({
				event_type: "request.accepted",
				request_id: "req_01",
				status: "accepted",
				surface: "campus_web",
				trace_id: "trace_01",
			}),
		).resolves.toBeUndefined();
	});

	it("uses the shared runtime event allowlist", () => {
		expect(sanitizeRuntimeEventPayload({ event_type: "experimental.debug_dump" })).toBeNull();
		expect(
			sanitizeRuntimeEventPayload({
				event_type: "request.transport_error",
				request_id: "req_01",
				retryable: true,
				status: "error",
				surface: "campus_web",
				trace_id: "trace_01",
			}),
		).toEqual({
			event_type: "request.transport_error",
			request_id: "req_01",
			retryable: true,
			status: "error",
			surface: "campus_web",
			trace_id: "trace_01",
		});
	});
});
