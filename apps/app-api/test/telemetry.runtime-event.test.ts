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
			"request.stage_timing",
			"request.transport_error",
			"identity.endpoint",
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

	it("allows bounded stage timing telemetry fields without raw payload material", () => {
		expect(
			sanitizeRuntimeEventPayload({
				budget_state: "critical",
				duration_ms: 5500,
				environment: "staging",
				event_type: "request.stage_timing",
				occurred_at: "2026-04-20T12:30:00.000Z",
				prompt: "raw prompt must not pass",
				release: "app-api@2026.04.20",
				request_id: "req_01HQ",
				selected_tool: "knowledge_query",
				stage_field: "stream.browser_ttft_ms",
				status: "completed",
				surface: "campus_web",
				trace_id: "trace_01HQ",
			}),
		).toEqual({
			budget_state: "critical",
			duration_ms: 5500,
			environment: "staging",
			event_type: "request.stage_timing",
			occurred_at: "2026-04-20T12:30:00.000Z",
			release: "app-api@2026.04.20",
			request_id: "req_01HQ",
			selected_tool: "knowledge_query",
			stage_field: "stream.browser_ttft_ms",
			status: "completed",
			surface: "campus_web",
			trace_id: "trace_01HQ",
		});
	});
});
