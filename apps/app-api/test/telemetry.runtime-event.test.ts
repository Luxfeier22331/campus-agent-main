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
		]);
	});

	it("drops forbidden sensitive fields before telemetry export", () => {
		expect(
			sanitizeRuntimeEventPayload({
				environment: "staging",
				event_type: "request.accepted",
				occurred_at: "2026-04-20T12:30:00.000Z",
				"campus.request_id": "req_01HQ",
				release: "app-api@2026.04.20",
				"campus.trace_id": "trace_01HQ",
				surface: "campus_web",
				status: "accepted",
				unexpected_blob: "should-not-pass",
				prompt: "library hours",
				answer: "open until 22:00",
				cookie: "better-auth.session_token=test",
				email: "person@example.com",
				transcript: "user: ...",
			}),
		).toEqual({
			environment: "staging",
			event_type: "request.accepted",
			occurred_at: "2026-04-20T12:30:00.000Z",
			"campus.request_id": "req_01HQ",
			release: "app-api@2026.04.20",
			status: "accepted",
			surface: "campus_web",
			"campus.trace_id": "trace_01HQ",
		});
	});

	it("drops unsupported event types instead of treating telemetry as a kitchen-sink dataset", () => {
		expect(
			sanitizeRuntimeEventPayload({
				event_type: "experimental.debug_dump",
				occurred_at: "2026-04-20T12:30:00.000Z",
				"campus.request_id": "req_01HQ",
				surface: "campus_web",
				"campus.trace_id": "trace_01HQ",
			}),
		).toBeNull();
	});

	it("bounds string values and drops non-finite numbers before console export", () => {
		const sanitized = sanitizeRuntimeEventPayload({
			duration_ms: Number.POSITIVE_INFINITY,
			event_type: "request.finalized",
			"campus.request_id": "r".repeat(300),
			status: "completed",
		});

		expect(sanitized?.["campus.request_id"]).toHaveLength(128);
		expect(sanitized).not.toHaveProperty("duration_ms");
	});

	it("allows bounded stage timing fields only on the final lifecycle log", () => {
		expect(
			sanitizeRuntimeEventPayload({
				duration_ms: 5500,
				environment: "staging",
				event_type: "request.finalized",
				occurred_at: "2026-04-20T12:30:00.000Z",
				prompt: "raw prompt must not pass",
				release: "app-api@2026.04.20",
				"campus.request_id": "req_01HQ",
				stage_timing_budget_state: "critical",
				"stream.app_api_ttft_ms": 5500,
				status: "completed",
				surface: "campus_web",
				"campus.trace_id": "trace_01HQ",
			}),
		).toEqual({
			duration_ms: 5500,
			environment: "staging",
			event_type: "request.finalized",
			occurred_at: "2026-04-20T12:30:00.000Z",
			release: "app-api@2026.04.20",
			"campus.request_id": "req_01HQ",
			stage_timing_budget_state: "critical",
			"stream.app_api_ttft_ms": 5500,
			status: "completed",
			surface: "campus_web",
			"campus.trace_id": "trace_01HQ",
		});
	});
});
