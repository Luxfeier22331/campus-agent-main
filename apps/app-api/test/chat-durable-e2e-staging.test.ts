// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	type ChatDurableE2eDependencies,
	runChatDurableE2eStaging,
} from "../e2e/chat-durable-staging";

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
		const calls: Array<{
			afterSequence?: number;
			body?: unknown;
			method?: string;
			password?: string;
			url: string;
		}> = [];
		const abortSubmitStream = vi.fn();

		const result = await runChatDurableE2eStaging(
			[
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
				"--conversation-id",
				"conv_existing",
				"--no-reset-identity",
				"--password",
				"StableSmokePass!123",
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
							agentRuntimeEvalProjection: {
								schema_version: "agent_runtime_eval_projection.v1",
								run: {
									status: "completed",
								},
								trajectory: {
									selected_tool: "knowledge_query",
								},
								planning: {
									planned_steps: ["indexed_lookup"],
								},
							},
							attempts: [
								{
									runId: "run_01HQ",
									workflowId: "campus-agent.chat.run_01HQ",
								},
							],
							results: [
								{
									resultKind: "agent_plan_result",
									sanitizedPayload: {
										planned_steps: ["indexed_lookup"],
									},
								},
							],
							run: {
								conversationId: "conv_01HQ",
								phase: "completed",
								requestId: "req_01HQ",
								runId: "run_01HQ",
								status: "completed",
								traceId: "trace_01HQ",
							},
							steps: [
								{
									stepId: "memory.recall",
									status: "completed",
								},
								{
									stepId: "agent.primary",
									status: "completed",
								},
								{
									stepId: "rag.plan",
									selectedTool: "knowledge_query",
									status: "completed",
								},
								{
									stepId: "retrieval.indexed_lookup",
									selectedTool: "knowledge_query",
									status: "completed",
								},
							],
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
										text: "示例大学本科学生国家奖学金评审办法",
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
				async mintSmokeSession(input) {
					calls.push({
						body: { resetIdentity: input.resetIdentity },
						password: input.password,
						url: "mintSmokeSession",
					});
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
			agentRuntimeEvalProjection: {
				schema_version: "agent_runtime_eval_projection.v1",
				planning: {
					planned_steps: ["indexed_lookup"],
				},
			},
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
			workflowTraceSummary: {
				selected_tool: "knowledge_query",
				trace_steps: [
					{ status: "completed", step_id: "memory.recall" },
					{ status: "completed", step_id: "agent.primary" },
					{ selected_tool: "knowledge_query", status: "completed", step_id: "rag.plan" },
					{
						selected_tool: "knowledge_query",
						status: "completed",
						step_id: "retrieval.indexed_lookup",
					},
				],
			},
		});
		expect(result.resume.events.map((event) => event.sequence)).toEqual([2, 3]);
		expect(result.conversation?.assistantAnswerText).toBe("国家奖学金每学年评审一次。");
		expect(result.conversation?.hasAssistantMessageForRequest).toBe(true);
		expect(result.runtimeStepResults).toEqual([
			{
				resultKind: "agent_plan_result",
				sanitizedPayload: {
					planned_steps: ["indexed_lookup"],
				},
			},
		]);
		expect(calls).toEqual(
			expect.arrayContaining([
				{ url: "https://api.example.com/readyz" },
				{ url: "https://campus.example.com/readyz" },
				{
					body: { resetIdentity: false },
					password: "StableSmokePass!123",
					url: "mintSmokeSession",
				},
				expect.objectContaining({
					body: {
						conversationId: "conv_existing",
						prompt: "示例大学本科学生国家奖学金评审办法",
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

	it("includes accepted run identity when durable run event streams end before completion", async () => {
		let resumeOpenCount = 0;
		await expect(
			runChatDurableE2eStaging(
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
						throw new Error(`unexpected json request: ${input.url}`);
					},
					async mintSmokeSession() {
						return "session=staging";
					},
					async openRunEventStream() {
						resumeOpenCount += 1;
						if (resumeOpenCount > 1) {
							return sseResponse([]);
						}
						return sseResponse([
							'event: execution.running\ndata: {"occurredAt":"2026-06-04T00:00:01.000Z","requestId":"req_timeout","runId":"run_timeout","sequence":2,"status":"running","traceId":"trace_timeout"}\n\n',
						]);
					},
					async openSubmitStream() {
						return sseResponse([
							'event: request.accepted\ndata: {"requestId":"req_timeout","runId":"run_timeout","status":"accepted","traceId":"trace_timeout"}\n\n',
						]);
					},
				},
			),
		).rejects.toThrow(
			"Run event streams ended before request.completed for runId=run_timeout requestId=req_timeout traceId=trace_timeout lastSequence=2",
		);
	});

	it("returns failed terminal durable runs as diagnostic artifacts", async () => {
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
					if (input.url.endsWith("/api/chat/runs/run_failed")) {
						return jsonResult({
							run: {
								conversationId: "conv_failed",
								requestId: "req_failed",
								runId: "run_failed",
								status: "failed",
								traceId: "trace_failed",
							},
						} as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
				async openRunEventStream() {
					return sseResponse([
						'event: request.failed\ndata: {"occurredAt":"2026-06-04T00:00:02.000Z","requestId":"req_failed","runId":"run_failed","sequence":6,"status":"failed","traceId":"trace_failed"}\n\n',
					]);
				},
				async openSubmitStream() {
					return sseResponse([
						'event: request.accepted\ndata: {"requestId":"req_failed","runId":"run_failed","status":"accepted","traceId":"trace_failed"}\n\n',
					]);
				},
			},
		);

		expect(result.passed).toBe(false);
		expect(result.run).toMatchObject({
			conversationId: "conv_failed",
			requestId: "req_failed",
			runId: "run_failed",
			status: "failed",
			traceId: "trace_failed",
		});
		expect(result.resume.terminalEvent).toMatchObject({
			event: "request.failed",
			runId: "run_failed",
			status: "failed",
		});
		expect(result.workflowTraceSummary).toBeNull();
		expect(result.conversation).toBeNull();
	});

	it("returns completed runs without assistant answers as diagnostic artifacts", async () => {
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
					if (input.url.endsWith("/api/chat/runs/run_no_answer")) {
						return jsonResult({
							run: {
								conversationId: "conv_no_answer",
								requestId: "req_no_answer",
								runId: "run_no_answer",
								status: "completed",
								traceId: "trace_no_answer",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/runs/run_no_answer/steps")) {
						return jsonResult({
							attempts: [{ runId: "run_no_answer", workflowId: "workflow_no_answer" }],
							results: [
								{
									resultKind: "agent_plan_result",
									sanitizedPayload: {
										planned_steps: ["indexed_lookup"],
									},
								},
							],
							run: {
								conversationId: "conv_no_answer",
								requestId: "req_no_answer",
								runId: "run_no_answer",
								status: "completed",
								traceId: "trace_no_answer",
							},
							steps: [{ stepId: "rag.plan", status: "completed" }],
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations/conv_no_answer")) {
						return jsonResult({
							conversation: {
								id: "conv_no_answer",
								messages: [
									{
										kind: null,
										requestId: "req_no_answer",
										role: "user",
										text: "现在校园卡丢了怎么办",
									},
								],
							},
						} as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
				async openRunEventStream() {
					return sseResponse([
						'event: request.completed\ndata: {"occurredAt":"2026-06-04T00:00:02.000Z","requestId":"req_no_answer","runId":"run_no_answer","sequence":6,"status":"completed","traceId":"trace_no_answer"}\n\n',
					]);
				},
				async openSubmitStream() {
					return sseResponse([
						'event: request.accepted\ndata: {"requestId":"req_no_answer","runId":"run_no_answer","status":"accepted","traceId":"trace_no_answer"}\n\n',
					]);
				},
			},
		);

		expect(result.passed).toBe(false);
		expect(result.workflowTraceSummary).toMatchObject({
			selected_tool: "none",
		});
		expect(result.runtimeStepResults).toEqual([
			{
				resultKind: "agent_plan_result",
				sanitizedPayload: {
					planned_steps: ["indexed_lookup"],
				},
			},
		]);
		expect(result.conversation).toBeNull();
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
