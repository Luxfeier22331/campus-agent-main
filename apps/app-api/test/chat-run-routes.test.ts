// @vitest-environment node

import { describe, expect, it } from "vitest";

import { __chatRunRoutesTestables } from "../src/app/routes/chat-run-routes";

describe("chat run routes", () => {
	it("maps durable queued events into resume stream queued events", () => {
		const event = __chatRunRoutesTestables.toChatRunResumeStreamEvent({
			event: {
				eventType: "execution.queued",
				occurredAt: "2026-06-04T01:02:03.000Z",
				payload: {
					status: "queued",
				},
				requestId: "req_0001",
				sequence: 1,
			},
			run: {
				acceptedAt: "2026-06-04T01:02:03.000Z",
				completedAt: null,
				conversationId: "conv_01HQ",
				durationMs: null,
				startedAt: null,
				phase: "queued",
				requestId: "req_0001",
				status: "queued",
			},
		});

		expect(event).toMatchObject({
			data: {
				requestId: "req_0001",
				sequence: 1,
				status: "queued",
			},
			event: "execution.queued",
		});
	});

	it("maps durable answer deltas into resume stream answer delta events", () => {
		const event = __chatRunRoutesTestables.toChatRunResumeStreamEvent({
			event: {
				eventType: "answer.delta",
				occurredAt: "2026-06-04T01:02:04.000Z",
				payload: {
					chunk_index: 2,
					delta: "每学年评审一次。",
					message_id: "msg_answer_stream",
				},
				requestId: "req_0001",
				sequence: 2,
			},
			run: {
				acceptedAt: "2026-06-04T01:02:03.000Z",
				completedAt: null,
				conversationId: "conv_01HQ",
				durationMs: null,
				startedAt: "2026-06-04T01:02:04.000Z",
				phase: "running",
				requestId: "req_0001",
				status: "streaming",
			},
		});

		expect(event).toMatchObject({
			data: {
				delta: "每学年评审一次。",
				messageId: "msg_answer_stream",
				requestId: "req_0001",
				sequence: 2,
				status: "streaming",
			},
			event: "answer.delta",
		});
	});

	it("maps durable run failed nested terminal errors into resume stream events", () => {
		const event = __chatRunRoutesTestables.toChatRunResumeStreamEvent({
			event: {
				eventType: "request.failed",
				occurredAt: "2026-06-04T01:02:06.000Z",
				payload: {
					error: {
						code: "agent_runtime_timeout",
						message: "Agent runtime request timed out.",
						retryable: true,
					},
					failure_kind: "agent_runtime_timeout",
					status: "failed",
					terminal_reason: "worker_unavailable",
				},
				requestId: "req_0001",
				sequence: 3,
			},
			run: {
				acceptedAt: "2026-06-04T01:02:03.000Z",
				completedAt: "2026-06-04T01:02:06.000Z",
				conversationId: "conv_01HQ",
				durationMs: 3_000,
				startedAt: "2026-06-04T01:02:04.000Z",
				phase: "failed",
				requestId: "req_0001",
				status: "failed",
				terminalReason: "worker_unavailable",
			},
		});

		expect(event).toMatchObject({
			data: {
				error: {
					code: "execution_timeout",
					message: "The agent runtime did not complete before its deadline.",
					retryable: true,
				},
				requestId: "req_0001",
				status: "failed",
			},
			event: "request.failed",
		});
	});

	it("rejects failed resume events without product retryability", () => {
		expect(() =>
			__chatRunRoutesTestables.toChatRunResumeStreamEvent({
				event: {
					eventType: "request.failed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						error: {
							code: "run_failed",
							message: "The request could not be completed.",
						},
						status: "failed",
					},
					requestId: "req_missing_retryable",
					sequence: 3,
				},
				run: {
					acceptedAt: "2026-06-04T01:02:03.000Z",
					completedAt: "2026-06-04T01:02:06.000Z",
					conversationId: "conv_01HQ",
					durationMs: 3_000,
					startedAt: "2026-06-04T01:02:04.000Z",
					phase: "failed",
					requestId: "req_missing_retryable",
					status: "failed",
					terminalReason: "execution_failed",
				},
			}),
		).toThrow("request.failed error.retryable is required");
	});
});
