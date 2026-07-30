// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createAppTelemetry, createConsoleRuntimeEventSink } from "../src/modules/telemetry";

describe("console runtime event sink", () => {
	it("writes one allowlisted structured lifecycle log without sensitive fields", async () => {
		const info = vi.fn();
		const sink = createConsoleRuntimeEventSink({ info });

		await sink.emit({
			conversation_id: "conv_secret",
			duration_ms: 1250,
			environment: "staging",
			event_type: "request.finalized",
			occurred_at: "2026-07-16T12:30:00.000Z",
			prompt: "private prompt",
			"campus.request_id": "req_01",
			status: "completed",
			surface: "campus_web",
			"campus.trace_id": "trace_01",
		});

		expect(info).toHaveBeenCalledTimes(1);
		const logged = info.mock.calls[0]?.[0];
		expect(logged).toMatchObject({
			duration_ms: 1250,
			event_type: "request.finalized",
			schema_version: "runtime-lifecycle-event-v1",
			source: "app-api.lifecycle",
		});
		expect(logged).not.toHaveProperty("conversation_id");
		expect(logged).not.toHaveProperty("prompt");
	});

	it("does not require an outbound ingest endpoint in deployed environments", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const telemetry = createAppTelemetry({ DEPLOYMENT_ENVIRONMENT: "staging" });

		await expect(
			telemetry.recordRequestAccepted({
				actor: { principalType: "campus_member", subject: "user_01" },
				conversationId: "conv_01",
				requestId: "req_01",
				status: "accepted",
				surface: "campus_web",
				traceId: "trace_01",
			}),
		).resolves.toBeUndefined();
		expect(info).toHaveBeenCalledTimes(1);
		info.mockRestore();
	});
});
