// @vitest-environment node

import { describe, expect, it } from "vitest";

import { __chatRunRoutesTestables } from "../src/app/routes/chat-run-routes";

describe("chat run routes", () => {
	it("maps durable queued events into resume stream queued events", () => {
		const event = __chatRunRoutesTestables.toChatRunResumeStreamEvent({
			event: {
				eventId: "event-run-queued",
				eventType: "run.queued",
				occurredAt: "2026-06-04T01:02:03.000Z",
				payload: {
					request_id: "req_0001",
					status: "queued",
					trace_id: "trace_0001",
				},
				runId: "run_0001",
				sequence: 1,
				visibility: "browser",
			},
			run: {
				conversationId: "conv_01HQ",
				phase: "queued",
				requestId: "req_0001",
				runId: "run_0001",
				status: "queued",
				traceId: "trace_0001",
			},
		});

		expect(event).toMatchObject({
			data: {
				requestId: "req_0001",
				runId: "run_0001",
				sequence: 1,
				status: "queued",
				traceId: "trace_0001",
			},
			event: "execution.queued",
		});
	});

	it("maps durable answer deltas into resume stream answer delta events", () => {
		const event = __chatRunRoutesTestables.toChatRunResumeStreamEvent({
			event: {
				eventId: "event-answer-delta",
				eventType: "run.answer_delta",
				occurredAt: "2026-06-04T01:02:04.000Z",
				payload: {
					accumulated_text: "国家奖学金每学年评审一次。",
					chunk_index: 2,
					delta: "每学年评审一次。",
					message_id: "msg_answer_stream",
					model_name: "gpt-5.5",
					model_provider: "openai",
					provider_request_ref: "provider://requests/run_0001/answer-writer",
					request_id: "req_0001",
					schema_version: "run_answer_delta.v1",
					trace_id: "trace_0001",
				},
				runId: "run_0001",
				sequence: 2,
				visibility: "browser",
			},
			run: {
				conversationId: "conv_01HQ",
				phase: "running",
				requestId: "req_0001",
				runId: "run_0001",
				status: "streaming",
				traceId: "trace_0001",
			},
		});

		expect(event).toMatchObject({
			data: {
				delta: "每学年评审一次。",
				messageId: "msg_answer_stream",
				requestId: "req_0001",
				runId: "run_0001",
				sequence: 2,
				status: "streaming",
				traceId: "trace_0001",
			},
			event: "answer.delta",
		});
	});

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
