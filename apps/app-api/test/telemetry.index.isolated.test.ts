// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
	captureException: vi.fn(),
	setContext: vi.fn(),
	setTag: vi.fn(),
	withScope: vi.fn((callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
		callback({
			setTag: vi.fn(),
		}),
	),
}));

vi.mock("@sentry/cloudflare", () => sentryMocks);

import * as telemetryModule from "../src/modules/telemetry";
import { createAppTelemetry } from "../src/modules/telemetry";
import {
	applyTracePropagationHeaders,
	deriveLangfuseTraceId,
	ensureLangfuseTraceParent,
	traceParentForLangfuseTraceId,
} from "../src/modules/telemetry/trace";

interface LangfuseTraceIdVector {
	langfuse_trace_id: string;
	product_trace_id: string;
	traceparent: string;
}

const TEST_TELEMETRY_ENV = { DEPLOYMENT_ENVIRONMENT: "test" };

function langfuseTraceIdVectors(): LangfuseTraceIdVector[] {
	const fixturePath = resolve(
		process.cwd(),
		"../../packages/eval-langfuse/test/fixtures/langfuse_trace_id_vectors.json",
	);
	const payload = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
		vectors: LangfuseTraceIdVector[];
	};
	return payload.vectors;
}

describe("app telemetry", () => {
	beforeEach(() => {
		sentryMocks.captureException.mockReset();
		sentryMocks.setContext.mockReset();
		sentryMocks.setTag.mockReset();
		sentryMocks.withScope.mockReset();
		sentryMocks.withScope.mockImplementation(
			(callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
				callback({
					setTag: vi.fn(),
				}),
		);
	});

	it("keeps the request path non-blocking when configureChatRequestScope hits a sentry error", () => {
		sentryMocks.setTag.mockImplementation(() => {
			throw new Error("sentry setTag failed");
		});

		const telemetry = createAppTelemetry(TEST_TELEMETRY_ENV, {
			runtimeEventSink: { emit: vi.fn() },
		});

		expect(() =>
			telemetry.configureChatRequestScope({
				actor: {
					principalType: "campus_member",
					subject: "user_01",
				},
				conversationId: "conv_01",
				requestId: "req_01",
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).not.toThrow();
	});

	it("derives deterministic Langfuse-compatible trace ids from product trace ids", async () => {
		const traceId = await deriveLangfuseTraceId("trace_0001");

		expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
		expect(traceId).toBe(await deriveLangfuseTraceId("trace_0001"));
		expect(traceId).not.toBe(await deriveLangfuseTraceId("trace_0002"));
		expect(traceParentForLangfuseTraceId(traceId)).toBe(`00-${traceId}-0000000000000001-01`);
	});

	it("matches shared Langfuse trace id derivation vectors used by eval publishing", async () => {
		for (const vector of langfuseTraceIdVectors()) {
			expect(await deriveLangfuseTraceId(vector.product_trace_id)).toBe(vector.langfuse_trace_id);
			expect(traceParentForLangfuseTraceId(vector.langfuse_trace_id)).toBe(vector.traceparent);
		}
	});

	it("pins the internal traceparent and drops browser propagation headers", async () => {
		const traceHeaders = await ensureLangfuseTraceParent("trace_0001");
		const langfuseTraceId = await deriveLangfuseTraceId("trace_0001");

		expect(traceHeaders).toEqual({
			traceParent: `00-${langfuseTraceId}-0000000000000001-01`,
		});
	});

	it("writes only a valid W3C traceparent", () => {
		const headers = new Headers();
		applyTracePropagationHeaders(headers, {
			traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		});

		expect(headers.get("traceparent")).toBe(
			"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		);
	});

	it("does not write malformed or zero W3C traceparents", () => {
		for (const traceParent of [
			"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-09",
			"00-00000000000000000000000000000000-00f067aa0ba902b7-01",
			"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
			"not-a-traceparent",
		]) {
			const headers = new Headers();
			applyTracePropagationHeaders(headers, { traceParent });
			expect(headers.has("traceparent")).toBe(false);
		}
	});

	it("keeps product identity out of Sentry while emitting the bounded runtime envelope", async () => {
		const runtimeEventSink = { emit: vi.fn().mockResolvedValue(undefined) };
		const telemetry = createAppTelemetry(
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				DEPLOYMENT_RELEASE: "app-api@2026.04.20",
			},
			{
				runtimeEventSink,
				now: () => new Date("2026-04-20T12:30:00.000Z"),
			},
		);
		const safetyIdentifier = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

		telemetry.configureChatRequestScope({
			actor: {
				principalType: "campus_member",
				subject: "user_01",
			},
			conversationId: "conv_01",
			requestId: "req_01",
			safetyIdentifier,
			surface: "campus_web",
			traceId: "trace_01",
		});

		await telemetry.recordRequestAccepted({
			actor: {
				principalType: "campus_member",
				subject: "user_01",
			},
			conversationId: "conv_01",
			requestId: "req_01",
			safetyIdentifier,
			status: "accepted",
			surface: "campus_web",
			traceId: "trace_01",
		});

		expect(sentryMocks.setTag).toHaveBeenCalledWith("campus.request_id", "req_01");
		expect(sentryMocks.setTag).toHaveBeenCalledWith("campus.trace_id", "trace_01");
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("safety_identifier", safetyIdentifier);
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("principal_type", "campus_member");
		expect(sentryMocks.setContext).not.toHaveBeenCalled();
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("correlation_hash", expect.any(String));
		expect(runtimeEventSink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				environment: "staging",
				event_type: "request.accepted",
				occurred_at: "2026-04-20T12:30:00.000Z",
				principal_type: "campus_member",
				"campus.request_id": "req_01",
				"campus.trace_id": "trace_01",
				release: "app-api@2026.04.20",
			}),
		);
		expect(runtimeEventSink.emit).not.toHaveBeenCalledWith(
			expect.objectContaining({ safety_identifier: safetyIdentifier }),
		);
	});

	it("does not fail request-path telemetry when runtime event ingest fails", async () => {
		const telemetry = createAppTelemetry(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
			},
			{
				runtimeEventSink: {
					emit: vi.fn().mockRejectedValue(new Error("Network connection lost.")),
				},
			},
		);

		await expect(
			telemetry.recordRequestAccepted({
				actor: {
					principalType: "campus_member",
					subject: "user_01",
				},
				conversationId: "conv_01",
				requestId: "req_01",
				safetyIdentifier: "safety_01",
				status: "accepted",
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).resolves.toBeUndefined();
	});

	it("folds only canonical stage timing into the single finalization log", async () => {
		const runtimeEventSink = { emit: vi.fn().mockResolvedValue(undefined) };
		const telemetry = createAppTelemetry(
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				DEPLOYMENT_RELEASE: "app-api@2026.07.04",
			},
			{
				runtimeEventSink,
				now: () => new Date("2026-07-04T12:30:00.000Z"),
			},
		);

		await telemetry.recordRequestFinalized({
			conversationId: "conv_01",
			durationMs: 5500,
			errorCode: null,
			modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
			principalType: "campus_member",
			requestId: "req_01",
			retryable: null,
			safetyIdentifier: null,
			sourceDocIds: [],
			stageTiming: {
				"stream.app_api_ttft_ms": 5500,
				"provider.queue_ms": 900,
			},
			status: "completed",
			surface: "campus_web",
			traceId: "trace_01",
		});

		expect(runtimeEventSink.emit).toHaveBeenCalledTimes(1);
		expect(runtimeEventSink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				duration_ms: 5500,
				event_type: "request.finalized",
				"campus.request_id": "req_01",
				stage_timing_budget_state: "critical",
				"stream.app_api_ttft_ms": 5500,
			}),
		);
		expect(runtimeEventSink.emit.mock.calls[0]?.[0]).not.toHaveProperty("provider.queue_ms");
	});

	it("does not expose a direct Axiom REST ingest adapter from the telemetry module", () => {
		expect("createAxiomRuntimeEventSink" in telemetryModule).toBe(false);
		expect("sanitizeAxiomEventPayload" in telemetryModule).toBe(false);
		expect("LEGACY_AXIOM_ALLOWED_EVENT_TYPES" in telemetryModule).toBe(false);
	});
});
