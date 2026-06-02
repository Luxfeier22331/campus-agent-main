// @vitest-environment node

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

import { createAppTelemetry } from "../src/modules/telemetry";

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

		const telemetry = createAppTelemetry({}, { axiomSink: { emit: vi.fn() } });

		expect(() =>
			telemetry.configureChatRequestScope({
				actor: {
					principalType: "campus_member",
					subject: "user_01",
				},
				conversationId: "conv_01",
				requestId: "req_01",
				requestedCapability: "knowledge",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
				surface: "public_chat_web",
				traceId: "trace_01",
			}),
		).not.toThrow();
	});

	it("returns empty trace headers when sentry trace data lookup throws", () => {
		sentryMocks.getTraceData.mockImplementation(() => {
			throw new Error("trace data failed");
		});

		const telemetry = createAppTelemetry({}, { axiomSink: { emit: vi.fn() } });

		expect(telemetry.getTraceHeaders()).toEqual({
			baggage: null,
			sentryTrace: null,
		});
	});

	it("moves high-cardinality request identity into sentry context and emits canonical axiom envelope", async () => {
		const axiomSink = { emit: vi.fn().mockResolvedValue(undefined) };
		const telemetry = createAppTelemetry(
			{
				APP_API_ENVIRONMENT: "staging",
				SENTRY_RELEASE: "app-api@2026.04.20",
			},
			{
				axiomSink,
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
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			safetyIdentifier,
			surface: "public_chat_web",
			traceId: "trace_01",
		});

		await telemetry.recordRequestAccepted({
			actor: {
				principalType: "campus_member",
				subject: "user_01",
			},
			conversationId: "conv_01",
			requestId: "req_01",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			safetyIdentifier,
			status: "accepted",
			surface: "public_chat_web",
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
		expect(axiomSink.emit).toHaveBeenCalledWith(
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
});
