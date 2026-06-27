// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
	captureException: vi.fn(),
	getTraceData: vi.fn(() => ({
		baggage: "test-baggage",
		"sentry-trace": "test-trace",
	})),
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
	deriveLangfuseTraceId,
	ensureLangfuseTraceParent,
	traceParentForLangfuseTraceId,
} from "../src/modules/telemetry/trace";

interface LangfuseTraceIdVector {
	langfuse_trace_id: string;
	product_trace_id: string;
	traceparent: string;
}

function langfuseTraceIdVectors(): LangfuseTraceIdVector[] {
	const fixturePath = resolve(process.cwd(), "../../tests/fixtures/langfuse_trace_id_vectors.json");
	const payload = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
		vectors: LangfuseTraceIdVector[];
	};
	return payload.vectors;
}

describe("app telemetry", () => {
	beforeEach(() => {
		sentryMocks.captureException.mockReset();
		sentryMocks.getTraceData.mockReset();
		sentryMocks.getTraceData.mockReturnValue({
			baggage: "test-baggage",
			"sentry-trace": "test-trace",
		});
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

		const telemetry = createAppTelemetry({}, { runtimeEventSink: { emit: vi.fn() } });

		expect(() =>
			telemetry.configureChatRequestScope({
				actor: {
					principalType: "campus_member",
					subject: "user_01",
				},
				conversationId: "conv_01",
				requestId: "req_01",
				requestedTool: "knowledge_query",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).not.toThrow();
	});

	it("returns empty trace headers when sentry trace data lookup throws", () => {
		sentryMocks.getTraceData.mockImplementation(() => {
			throw new Error("trace data failed");
		});

		const telemetry = createAppTelemetry({}, { runtimeEventSink: { emit: vi.fn() } });

		expect(telemetry.getTraceHeaders()).toEqual({
			baggage: null,
			sentryTrace: null,
			traceParent: null,
		});
	});

	it("prefers W3C traceparent while preserving Sentry propagation headers", () => {
		const telemetry = createAppTelemetry({}, { runtimeEventSink: { emit: vi.fn() } });
		const request = new Request("https://app-api.internal/api/chat", {
			headers: {
				baggage: "session=conv_01",
				"sentry-trace": "4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1",
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
			},
		});

		expect(telemetry.getTraceHeaders({ request })).toEqual({
			baggage: "session=conv_01",
			sentryTrace: "4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1",
			traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		});
	});

	it("derives deterministic Langfuse-compatible trace ids from product trace ids", () => {
		const traceId = deriveLangfuseTraceId("trace_0001");

		expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
		expect(traceId).toBe(deriveLangfuseTraceId("trace_0001"));
		expect(traceId).not.toBe(deriveLangfuseTraceId("trace_0002"));
		expect(traceParentForLangfuseTraceId(traceId)).toBe(`00-${traceId}-0000000000000001-01`);
	});

	it("matches shared Langfuse trace id derivation vectors used by eval publishing", () => {
		for (const vector of langfuseTraceIdVectors()) {
			expect(deriveLangfuseTraceId(vector.product_trace_id)).toBe(vector.langfuse_trace_id);
			expect(traceParentForLangfuseTraceId(vector.langfuse_trace_id)).toBe(vector.traceparent);
		}
	});

	it("pins execution-control traceparent to the product-derived Langfuse trace id", () => {
		const traceHeaders = ensureLangfuseTraceParent(
			{
				baggage: "session=conv_01",
				sentryTrace: "4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1",
				traceParent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
			},
			"trace_0001",
		);
		const langfuseTraceId = deriveLangfuseTraceId("trace_0001");

		expect(traceHeaders).toEqual({
			baggage: "session=conv_01",
			sentryTrace: "4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1",
			traceParent: `00-${langfuseTraceId}-0000000000000001-01`,
		});
	});

	it("moves high-cardinality request identity into sentry context and emits canonical runtime event envelope", async () => {
		const runtimeEventSink = { emit: vi.fn().mockResolvedValue(undefined) };
		const telemetry = createAppTelemetry(
			{
				APP_API_ENVIRONMENT: "staging",
				SENTRY_RELEASE: "app-api@2026.04.20",
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
			requestedTool: "knowledge_query",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
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
			requestedTool: "knowledge_query",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			safetyIdentifier,
			status: "accepted",
			surface: "campus_web",
			traceId: "trace_01",
		});

		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("request_id", "req_01");
		expect(sentryMocks.setTag).not.toHaveBeenCalledWith("safety_identifier", safetyIdentifier);
		expect(sentryMocks.setTag).toHaveBeenCalledWith(
			"requested_scope_summary",
			"regulations/student_rules",
		);
		expect(sentryMocks.setTag).toHaveBeenCalledWith("principal_type", "campus_member");
		expect(sentryMocks.setContext).toHaveBeenCalledWith(
			"request",
			expect.objectContaining({
				conversation_id: "conv_01",
				request_id: "req_01",
				requested_scope_summary: "regulations/student_rules",
				safety_identifier: safetyIdentifier,
			}),
		);
		expect(runtimeEventSink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				environment: "staging",
				event_type: "request.accepted",
				occurred_at: "2026-04-20T12:30:00.000Z",
				principal_type: "campus_member",
				request_id: "req_01",
				release: "app-api@2026.04.20",
				safety_identifier: safetyIdentifier,
			}),
		);
	});

	it("does not fail request-path telemetry when runtime event ingest fails", async () => {
		const telemetry = createAppTelemetry(
			{
				APP_API_ENVIRONMENT: "test",
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
				requestedTool: null,
				requestedScope: null,
				safetyIdentifier: "safety_01",
				status: "accepted",
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).resolves.toBeUndefined();
	});

	it("emits identity endpoint telemetry without auth-sensitive fields", async () => {
		const runtimeEventSink = { emit: vi.fn().mockResolvedValue(undefined) };
		const telemetry = createAppTelemetry(
			{
				APP_API_ENVIRONMENT: "staging",
				SENTRY_RELEASE: "app-api@2026.06.02",
			},
			{
				runtimeEventSink,
				now: () => new Date("2026-06-02T12:30:00.000Z"),
			},
		);

		await telemetry.recordIdentityEndpoint({
			correlationId: "corr_01HQ",
			endpoint: "/api/me/identity",
			errorCode: null,
			principalType: "student",
			status: 200,
			surface: "campus_web",
		});

		expect(runtimeEventSink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				correlation_id: "corr_01HQ",
				endpoint: "/api/me/identity",
				environment: "staging",
				error_code: null,
				event_type: "identity.endpoint",
				occurred_at: "2026-06-02T12:30:00.000Z",
				principal_type: "student",
				release: "app-api@2026.06.02",
				status: "200",
				surface: "campus_web",
			}),
		);
		expect(runtimeEventSink.emit).not.toHaveBeenCalledWith(
			expect.objectContaining({
				cookie: expect.anything(),
				email: expect.anything(),
				token: expect.anything(),
			}),
		);
	});

	it("does not expose a direct Axiom REST ingest adapter from the telemetry module", () => {
		expect("createAxiomRuntimeEventSink" in telemetryModule).toBe(false);
		expect("sanitizeAxiomEventPayload" in telemetryModule).toBe(false);
		expect("LEGACY_AXIOM_ALLOWED_EVENT_TYPES" in telemetryModule).toBe(false);
	});
});
