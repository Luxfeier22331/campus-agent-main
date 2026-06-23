// @vitest-environment node

import { describe, expect, it } from "vitest";

import { __chatRunRoutesTestables } from "../src/app/routes/chat-run-routes";

describe("chat run routes", () => {
	it("maps durable run failed nested terminal errors into resume stream events", () => {
		const event = __chatRunRoutesTestables.toChatRunResumeStreamEvent({
			event: {
				eventId: "event-run-failed",
				eventType: "run.failed",
				occurredAt: "2026-06-04T01:02:06.000Z",
				payload: {
					error: {
						code: "agent_runtime_timeout",
						message: "Agent runtime request timed out.",
						retryable: true,
					},
					failure_kind: "agent_runtime_timeout",
					request_id: "req_0001",
					status: "failed",
					terminal_reason: "worker_unavailable",
					trace_id: "trace_0001",
				},
				runId: "run_0001",
				sequence: 3,
				visibility: "browser",
			},
			run: {
				conversationId: "conv_01HQ",
				phase: "failed",
				requestId: "req_0001",
				runId: "run_0001",
				status: "failed",
				terminalReason: "worker_unavailable",
				traceId: "trace_0001",
			},
		});

		expect(event).toMatchObject({
			data: {
				error: {
					code: "agent_runtime_timeout",
					message: "Agent runtime request timed out.",
					retryable: true,
				},
				requestId: "req_0001",
				runId: "run_0001",
				status: "failed",
				traceId: "trace_0001",
			},
			event: "request.failed",
		});
	});
});
