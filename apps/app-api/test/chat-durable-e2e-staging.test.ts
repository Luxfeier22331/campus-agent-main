// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	type ChatDurableE2eDependencies,
	runChatDurableE2eStaging,
} from "../scripts/chat-durable-e2e-staging";

function jsonResult<T>(
	payload: T,
	response = new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
	}),
): { payload: T; response: Response } {
	return {
		payload,
		response,
	};
}

function sseResponse(blocks: string[]): Response {
	return new Response(blocks.join(""), {
		headers: { "content-type": "text/event-stream" },
		status: 200,
	});
}

describe("chat durable staging e2e runner", () => {
	it("aborts the submit stream after request.accepted and resumes the same durable run by cursor", async () => {
		const calls: Array<{ afterSequence?: number; body?: unknown; method?: string; url: string }> =
			[];
		const abortSubmitStream = vi.fn();

		const result = await runChatDurableE2eStaging(
			[
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
			],
			{
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv,
			{
				abortSubmitStream,
				async fetchReadyz(url) {
					calls.push({ url });
					return {
						payload: { ok: true },
						status: 200,
					};
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<NonNullable<ChatDurableE2eDependencies["fetchJsonWithCookie"]>>[0],
				) {
					calls.push({
						body: input.body,
						method: input.method,
						url: input.url,
					});
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
								operator: false,
							},
							principal: {
								email: "help_bot@outlook.com",
								principalId: "user_staging",
								type: "user",
							},
							session: {
								expiresAt: "2099-01-01T00:00:00Z",
								sessionId: "session_staging",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/runs/run_01HQ")) {
						return jsonResult({
							run: {
								conversationId: "conv_01HQ",
								requestId: "req_01HQ",
								runId: "run_01HQ",
								status: "completed",
								traceId: "trace_01HQ",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/runs/run_01HQ/steps")) {
						return jsonResult({
							attempts: [
								{
									runId: "run_01HQ",
									workflowId: "campus-agent.chat.run_01HQ",
								},
							],
							results: [],
							run: {
								conversationId: "conv_01HQ",
								phase: "completed",
								requestId: "req_01HQ",
								runId: "run_01HQ",
								status: "completed",
								traceId: "trace_01HQ",
							},
							steps: [],
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations/conv_01HQ")) {
						return jsonResult({
							conversation: {
								createdAt: "2026-06-04T00:00:00.000Z",
								id: "conv_01HQ",
								messages: [
									{
										createdAt: "2026-06-04T00:00:01.000Z",
										id: "msg_user",
										kind: null,
										requestId: "req_01HQ",
										retryable: false,
										role: "user",
										text: "中央民族大学本科学生国家奖学金评审办法",
									},
									{
										createdAt: "2026-06-04T00:00:02.000Z",
										id: "msg_answer",
										kind: "answer",
										requestId: "req_01HQ",
										retryable: false,
										role: "assistant",
										text: "国家奖学金每学年评审一次。",
									},
								],
								title: "国家奖学金",
								updatedAt: "2026-06-04T00:00:02.000Z",
							},
						} as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
				async openRunEventStream(input) {
					calls.push({
						afterSequence: input.afterSequence,
						url: input.url,
					});
					return sseResponse([
						'event: execution.running\ndata: {"occurredAt":"2026-06-04T00:00:01.000Z","requestId":"req_01HQ","runId":"run_01HQ","sequence":2,"status":"running","traceId":"trace_01HQ"}\n\n',
						'event: request.completed\ndata: {"occurredAt":"2026-06-04T00:00:02.000Z","requestId":"req_01HQ","runId":"run_01HQ","sequence":3,"status":"completed","traceId":"trace_01HQ"}\n\n',
					]);
				},
				async openSubmitStream(input) {
					calls.push({
						body: input.body,
						method: "POST",
						url: input.url,
					});
					return sseResponse([
						'event: request.accepted\ndata: {"occurredAt":"2026-06-04T00:00:00.000Z","requestId":"req_01HQ","runId":"run_01HQ","runPhase":"queued","status":"accepted","traceId":"trace_01HQ"}\n\n',
						'event: execution.running\ndata: {"occurredAt":"2026-06-04T00:00:01.000Z","requestId":"req_01HQ","status":"running","traceId":"trace_01HQ"}\n\n',
					]);
				},
			},
		);

		expect(abortSubmitStream).toHaveBeenCalledOnce();
		expect(result.passed).toBe(true);
		expect(result.submitStreamAbortedAfterAccepted).toBe(true);
		expect(result.run).toMatchObject({
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			status: "completed",
			traceId: "trace_01HQ",
		});
		expect(result).toMatchObject({
			langfuseCloseout: {
				productTraceId: "trace_01HQ",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				sessionId: "conv_01HQ",
				userId: "user_staging",
				workflowId: "campus-agent.chat.run_01HQ",
			},
			workflow: {
				attemptCount: 1,
				workflowId: "campus-agent.chat.run_01HQ",
			},
		});
		expect(result.resume.events.map((event) => event.sequence)).toEqual([2, 3]);
		expect(result.conversation?.hasAssistantMessageForRequest).toBe(true);
		expect(calls).toEqual(
			expect.arrayContaining([
				{ url: "https://api.example.com/readyz" },
				{ url: "https://campus.example.com/readyz" },
				expect.objectContaining({
					body: {
						prompt: "中央民族大学本科学生国家奖学金评审办法",
					},
					method: "POST",
					url: "https://campus.example.com/api/chat/requests/stream",
				}),
				{
					afterSequence: 0,
					url: "https://campus.example.com/api/chat/runs/run_01HQ/events/stream?after_sequence=0",
				},
				{
					method: "GET",
					url: "https://campus.example.com/api/chat/runs/run_01HQ",
				},
				{
					method: "GET",
					url: "https://campus.example.com/api/chat/runs/run_01HQ/steps",
				},
				{
					method: "GET",
					url: "https://campus.example.com/api/chat/conversations/conv_01HQ",
				},
			]),
		);
	});

	it("reopens the durable run event stream from the last observed sequence", async () => {
		const calls: Array<{ afterSequence?: number; url: string }> = [];
		let resumeOpenCount = 0;

		const result = await runChatDurableE2eStaging(
			["--chat-base-url", "https://campus.example.com"],
			{ APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret" } as NodeJS.ProcessEnv,
			{
				async fetchReadyz() {
					return { payload: { ok: true }, status: 200 };
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<NonNullable<ChatDurableE2eDependencies["fetchJsonWithCookie"]>>[0],
				) {
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: { chat: true, operator: false },
							principal: { principalId: "user_staging" },
							session: null,
						} as T);
					}
					if (input.url.endsWith("/api/chat/runs/run_01HQ")) {
						return jsonResult({
							run: {
								conversationId: "conv_01HQ",
								requestId: "req_01HQ",
								runId: "run_01HQ",
								status: "completed",
								traceId: "trace_01HQ",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/runs/run_01HQ/steps")) {
						return jsonResult({
							attempts: [{ runId: "run_01HQ", workflowId: "workflow_01HQ" }],
							results: [],
							run: {
								requestId: "req_01HQ",
								runId: "run_01HQ",
								traceId: "trace_01HQ",
							},
							steps: [],
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations/conv_01HQ")) {
						return jsonResult({
							conversation: {
								id: "conv_01HQ",
								messages: [
									{ kind: "answer", requestId: "req_01HQ", role: "assistant", text: "done" },
								],
							},
						} as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
				async openRunEventStream(input) {
					resumeOpenCount += 1;
					calls.push({ afterSequence: input.afterSequence, url: input.url });
					if (resumeOpenCount === 1) {
						return sseResponse([
							'event: execution.running\ndata: {"occurredAt":"2026-06-04T00:00:01.000Z","requestId":"req_01HQ","runId":"run_01HQ","sequence":2,"status":"running","traceId":"trace_01HQ"}\n\n',
						]);
					}
					return sseResponse([
						'event: request.completed\ndata: {"occurredAt":"2026-06-04T00:00:02.000Z","requestId":"req_01HQ","runId":"run_01HQ","sequence":3,"status":"completed","traceId":"trace_01HQ"}\n\n',
					]);
				},
				async openSubmitStream() {
					return sseResponse([
						'event: request.accepted\ndata: {"requestId":"req_01HQ","runId":"run_01HQ","status":"accepted","traceId":"trace_01HQ"}\n\n',
					]);
				},
			},
		);

		expect(result.resume.events.map((event) => event.sequence)).toEqual([2, 3]);
		expect(calls).toEqual([
			{
				afterSequence: 0,
				url: "https://campus.example.com/api/chat/runs/run_01HQ/events/stream?after_sequence=0",
			},
			{
				afterSequence: 2,
				url: "https://campus.example.com/api/chat/runs/run_01HQ/events/stream?after_sequence=2",
			},
		]);
	});

	it("fails closed when the accepted stream event does not include a durable run id", async () => {
		await expect(
			runChatDurableE2eStaging(
				[
					"--chat-base-url",
					"https://campus.example.com",
					"--app-api-readyz-url",
					"https://api.example.com/readyz",
				],
				{
					APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
				} as NodeJS.ProcessEnv,
				{
					async fetchReadyz() {
						return {
							payload: { ok: true },
							status: 200,
						};
					},
					async fetchJsonWithCookie<T>(
						input: Parameters<NonNullable<ChatDurableE2eDependencies["fetchJsonWithCookie"]>>[0],
					) {
						if (input.url.endsWith("/api/me")) {
							return jsonResult({
								permissions: { chat: true, operator: false },
								principal: {
									email: "help_bot@outlook.com",
									principalId: "user_staging",
									type: "user",
								},
								session: null,
							} as T);
						}
						throw new Error(`unexpected json request: ${input.url}`);
					},
					async mintSmokeSession() {
						return "session=staging";
					},
					async openRunEventStream() {
						throw new Error("resume stream must not open without a durable run id.");
					},
					async openSubmitStream() {
						return sseResponse([
							'event: request.accepted\ndata: {"occurredAt":"2026-06-04T00:00:00.000Z","requestId":"req_01HQ","status":"accepted","traceId":"trace_01HQ"}\n\n',
						]);
					},
				},
			),
		).rejects.toThrow(
			'request.accepted must include a durable run id: {"keys":["occurredAt","requestId","status","traceId"],"requestId":"req_01HQ","status":"accepted","traceId":"trace_01HQ"}',
		);
	});
});
