// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	RUNTIME_EVENT_ALLOWED_EVENT_TYPES,
	sanitizeRuntimeEventPayload,
} from "../src/modules/telemetry/runtime-event";

describe("runtime event sanitizer", () => {
	it("freezes the runtime telemetry event allowlist", () => {
		expect(RUNTIME_EVENT_ALLOWED_EVENT_TYPES).toEqual([
			"request.accepted",
			"request.finalized",
			"request.transport_error",
			"projection.enqueued",
			"projection.drain",
			"quality.sampled_grade",
			"identity.endpoint",
			"execution.admission_rejected",
			"execution.cancel_requested",
			"execution.cancelled",
			"execution.runtime_failed",
			"execution.timed_out",
		]);
	});

	it("drops forbidden sensitive fields before telemetry export", () => {
		expect(
			sanitizeRuntimeEventPayload({
				environment: "staging",
				event_type: "request.accepted",
				occurred_at: "2026-04-20T12:30:00.000Z",
				request_id: "req_01HQ",
				release: "app-api@2026.04.20",
				trace_id: "trace_01HQ",
				surface: "campus_web",
				status: "accepted",
				unexpected_blob: "should-not-pass",
				prompt: "library hours",
				answer: "open until 22:00",
				cookie: "better-auth.session_token=test",
				operator_email: "ops@example.com",
				transcript: "user: ...",
			}),
		).toEqual({
			environment: "staging",
			event_type: "request.accepted",
			occurred_at: "2026-04-20T12:30:00.000Z",
			request_id: "req_01HQ",
			release: "app-api@2026.04.20",
			status: "accepted",
			surface: "campus_web",
			trace_id: "trace_01HQ",
		});
	});

	it("drops unsupported event types instead of treating telemetry as a kitchen-sink dataset", () => {
		expect(
			sanitizeRuntimeEventPayload({
				event_type: "experimental.debug_dump",
				occurred_at: "2026-04-20T12:30:00.000Z",
				request_id: "req_01HQ",
				surface: "campus_web",
				trace_id: "trace_01HQ",
			}),
		).toBeNull();
	});

	it("allows only safe execution audit event fields", () => {
		expect(
			sanitizeRuntimeEventPayload({
				answer: "raw answer must not pass",
								decision: "queue_full",
				duration_ms: 35012,
				environment: "staging",
				event_type: "execution.runtime_failed",
				failure_kind: "timeout",
				http_status: 504,
				lane: "rag",
				occurred_at: "2026-04-24T10:00:00.000Z",
				prompt: "raw prompt must not pass",
				queue_wait_ms: 12,
				release: "app-api@2026.04.24",
				request_id: "req_01HQ",
				requested_capability: "knowledge",
				retryable: true,
				status: "error",
				surface: "campus_web",
				trace_id: "trace_01HQ",
			}),
		).toEqual({
						decision: "queue_full",
			duration_ms: 35012,
			environment: "staging",
			event_type: "execution.runtime_failed",
			failure_kind: "timeout",
			http_status: 504,
			lane: "rag",
			occurred_at: "2026-04-24T10:00:00.000Z",
			queue_wait_ms: 12,
			release: "app-api@2026.04.24",
			request_id: "req_01HQ",
			requested_capability: "knowledge",
			retryable: true,
			status: "error",
			surface: "campus_web",
			trace_id: "trace_01HQ",
		});
	});
});
