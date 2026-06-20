// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createAppTelemetry } from "../src/modules/telemetry";
import {
	createOtlpRuntimeEventSink,
	sanitizeOtlpEventPayload,
} from "../src/modules/telemetry/otlp";

describe("app-api OTLP runtime event sink", () => {
	it("posts sanitized lifecycle events to the controlled OTLP ingest endpoint", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const sink = createOtlpRuntimeEventSink(
			{
				APP_API_ENVIRONMENT: "staging",
				APP_API_OTEL_INGEST_ENDPOINT: "https://otel-ingest.example.com",
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
			"https://otel-ingest.example.com/v1/traces",
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
			"https://otel-ingest.example.com/v1/logs",
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
				APP_API_OTEL_INGEST_ENDPOINT: "https://otel-ingest.example.com",
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

	it("uses the same event allowlist as the transitional Axiom path", () => {
		expect(sanitizeOtlpEventPayload({ event_type: "experimental.debug_dump" })).toBeNull();
		expect(
			sanitizeOtlpEventPayload({
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
