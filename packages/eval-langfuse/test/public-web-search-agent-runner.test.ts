import { describe, expect, it } from "vitest";

import { runPublicWebSearchAgentEval } from "../src/public-web-search-agent-runner";
import type { JsonObject } from "../src/shared";

function sse(event: string, data: JsonObject): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
		status: init?.status ?? 200,
	});
}

function runStepsResponse(toolTrajectory: JsonObject): Response {
	return jsonResponse({
		agentRuntimeEvalProjection: {
			schema_version: "agent_runtime_eval_projection.v1",
			tool_trajectory: toolTrajectory,
		},
		attempts: [],
		results: [],
		steps: [],
	});
}

describe("public web search agent eval runner", () => {
	it("runs cases through the product chat stream and builds deterministic Langfuse scores", async () => {
		let streamCalls = 0;
		const requests: Array<{ body: unknown; url: string }> = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/api/chat/requests/stream")) {
				streamCalls += 1;
				const requestId = streamCalls === 1 ? "req_public_web" : "req_direct";
				const conversationId = streamCalls === 1 ? "conv_public_web" : "conv_direct";
				const runId = streamCalls === 1 ? "run_public_web" : "run_direct";
				const traceId = streamCalls === 1 ? "trace_public_web" : "trace_direct";
				const text = streamCalls === 1 ? "可参考中央民族大学上网指南。" : "我可以直接回答。";
				requests.push({
					body: init?.body ? JSON.parse(String(init.body)) : null,
					url,
				});
				return new Response(
					sse("request.accepted", {
						occurredAt: "2026-07-02T00:00:00.000Z",
						requestId,
						runId,
						status: "accepted",
						traceId,
					}) +
						sse("request.completed", {
							answer: {
								conversation: {
									id: conversationId,
									messages: [],
								},
								result: {
									kind: "answer",
									requestId,
									text,
									traceId,
								},
							},
							occurredAt: "2026-07-02T00:00:05.000Z",
							requestId,
							status: "completed",
							traceId,
						}),
					{
						headers: { "content-type": "text/event-stream" },
						status: 200,
					},
				);
			}
			if (url.endsWith("/api/chat/runs/run_public_web/steps")) {
				return runStepsResponse({
					available_tools: ["knowledge_query", "public_web_search"],
					conversation_id: "conv_public_web",
					decision_kind: "tool_call",
					request_id: "req_public_web",
					run_id: "run_public_web",
					schema_version: "tool_trajectory.v1",
					selected_tool: "public_web_search",
					surface: "campus-web",
					tool_calls: [
						{
							result_kind: "public_web_evidence",
							status: "completed",
							tool_call_id: "call_public_web",
							tool_name: "public_web_search",
						},
					],
					trace_id: "trace_public_web",
				});
			}
			if (url.endsWith("/api/chat/runs/run_direct/steps")) {
				return runStepsResponse({
					available_tools: ["knowledge_query", "public_web_search"],
					conversation_id: "conv_direct",
					decision_kind: "direct_answer",
					request_id: "req_direct",
					run_id: "run_direct",
					schema_version: "tool_trajectory.v1",
					tool_calls: [],
					trace_id: "trace_direct",
				});
			}
			if (url.endsWith("/api/chat/conversations/conv_public_web")) {
				return jsonResponse({
					conversation: {
						id: "conv_public_web",
						messages: [
							{
								kind: "answer",
								requestId: "req_public_web",
								role: "assistant",
								structuredParts: [
									{
										sourceItems: [
											{
												primaryAction: {
													external: true,
													href: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
													label: "打开网页",
												},
												publisherLabel: "中央民族大学",
												snippet: "校园网用户名是学号。",
												title: "上网指南",
											},
										],
										type: "source_items",
									},
								],
								text: "可参考中央民族大学上网指南。",
							},
						],
						title: "校园网密码",
					},
				});
			}
			if (url.endsWith("/api/chat/conversations/conv_direct")) {
				return jsonResponse({
					conversation: {
						id: "conv_direct",
						messages: [
							{
								kind: "answer",
								requestId: "req_direct",
								role: "assistant",
								structuredParts: [],
								text: "我可以直接回答。",
							},
						],
						title: "direct",
					},
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		};

		const result = await runPublicWebSearchAgentEval({
			assetPayload: {
				cases: [
					{
						case_id: "public-web-campus-network-password",
						expected_tool: "public_web_search",
						min_sources: 1,
						query: "校园网密码怎么改",
						required_allowed_url_patterns: [
							"https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/*",
						],
						required_answer_facts: ["说明校园网密码或上网账号相关处理入口"],
					},
					{
						case_id: "direct-smalltalk",
						expected_tool: "direct_answer",
						min_sources: 0,
						query: "你好",
						required_allowed_url_patterns: [],
						required_answer_facts: [],
					},
				],
				eval_kinds: ["routing_tool_selection", "source_quality", "answer_grounding"],
				schema_version: "public_web_search_agent_eval.v1",
			},
			baseUrl: "https://campus-staging.example",
			cookieHeader: "session=abc",
			dryRun: true,
			environment: "test",
			fetchImpl,
			model: "gemini-2.5-flash",
			provider: "gemini",
			providerProfileId: "provider_profile_public_web_search_gemini",
			settings: {
				baseUrl: "",
				environment: "test",
				publicKey: "",
				secretKey: "",
			},
		});

		expect(requests).toEqual([
			{
				body: { prompt: "校园网密码怎么改" },
				url: "https://campus-staging.example/api/chat/requests/stream",
			},
			{
				body: { prompt: "你好" },
				url: "https://campus-staging.example/api/chat/requests/stream",
			},
		]);
		expect(result.passed).toBe(true);
		expect(result.case_count).toBe(2);
		expect(result.provider_profile_id).toBe("provider_profile_public_web_search_gemini");
		expect(result.provider).toBe("gemini");
		expect(result.transport).toBe("gemini_google_search");
		expect(result.model).toBe("gemini-2.5-flash");
		expect(result.environment).toBe("test");
		expect(result.cost_projection_status).toBe("unavailable");
		expect(result.summary).toMatchObject({
			failed_count: 0,
			passed_count: 2,
			provider_error_count: 0,
		});
		expect(result.summary).toHaveProperty("p50_duration_ms");
		expect(result.summary).toHaveProperty("p95_duration_ms");
		expect(result.cases).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actual_tool: "public_web_search",
					case_id: "public-web-campus-network-password",
					decision_kind: "tool_call",
					duration_ms: expect.any(Number),
					required_source_covered: true,
					tool_trajectory_schema_version: "tool_trajectory.v1",
				}),
				expect.objectContaining({
					actual_tool: "direct_answer",
					case_id: "direct-smalltalk",
					decision_kind: "direct_answer",
					duration_ms: expect.any(Number),
					required_source_covered: true,
					tool_trajectory_schema_version: "tool_trajectory.v1",
				}),
			]),
		);
		expect(result.score_items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "agent.tool_selection.correct",
					trace_id: "trace_public_web",
					value: 1,
				}),
				expect.objectContaining({
					name: "public_web_search.source_policy.valid",
					trace_id: "trace_public_web",
					value: 1,
				}),
				expect.objectContaining({
					name: "public_web_search.required_source.covered",
					trace_id: "trace_public_web",
					value: 1,
				}),
				expect.objectContaining({
					name: "public_web_search.source_count",
					trace_id: "trace_public_web",
					value: 1,
				}),
			]),
		);
	});

	it("scores tool selection from tool trajectory instead of source cards", async () => {
		const fetchImpl: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/api/chat/requests/stream")) {
				return new Response(
					sse("request.accepted", {
						requestId: "req_wrong_tool",
						runId: "run_wrong_tool",
						status: "accepted",
						traceId: "trace_wrong_tool",
					}) +
						sse("request.completed", {
							answer: {
								conversation: { id: "conv_wrong_tool", messages: [] },
								result: {
									kind: "answer",
									requestId: "req_wrong_tool",
									text: "可参考中央民族大学上网指南。",
									traceId: "trace_wrong_tool",
								},
							},
							requestId: "req_wrong_tool",
							status: "completed",
							traceId: "trace_wrong_tool",
						}),
					{ headers: { "content-type": "text/event-stream" }, status: 200 },
				);
			}
			if (url.endsWith("/api/chat/runs/run_wrong_tool/steps")) {
				return runStepsResponse({
					available_tools: ["knowledge_query", "public_web_search"],
					conversation_id: "conv_wrong_tool",
					decision_kind: "tool_call",
					request_id: "req_wrong_tool",
					run_id: "run_wrong_tool",
					schema_version: "tool_trajectory.v1",
					selected_tool: "knowledge_query",
					tool_calls: [
						{
							result_kind: "knowledge_evidence",
							status: "completed",
							tool_call_id: "call_wrong_tool",
							tool_name: "knowledge_query",
						},
					],
					trace_id: "trace_wrong_tool",
				});
			}
			if (url.endsWith("/api/chat/conversations/conv_wrong_tool")) {
				return jsonResponse({
					conversation: {
						id: "conv_wrong_tool",
						messages: [
							{
								kind: "answer",
								requestId: "req_wrong_tool",
								role: "assistant",
								structuredParts: [
									{
										sourceItems: [
											{
												primaryAction: {
													external: true,
													href: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
													label: "打开网页",
												},
												title: "上网指南",
											},
										],
										type: "source_items",
									},
								],
								text: "可参考中央民族大学上网指南。",
							},
						],
					},
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		};

		const result = await runPublicWebSearchAgentEval({
			assetPayload: {
				cases: [
					{
						case_id: "wrong-tool-despite-public-source-card",
						expected_tool: "public_web_search",
						min_sources: 1,
						query: "校园网密码怎么改",
						required_allowed_url_patterns: [
							"https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/*",
						],
						required_answer_facts: [],
					},
				],
				eval_kinds: ["routing_tool_selection", "source_quality", "answer_grounding"],
				schema_version: "public_web_search_agent_eval.v1",
			},
			baseUrl: "https://campus-staging.example",
			cookieHeader: "session=abc",
			dryRun: true,
			environment: "test",
			fetchImpl,
			model: "gpt-5-search-api-2025-10-14",
			provider: "linux_do",
			providerProfileId: "provider_profile_public_web_search_linux_do",
			settings: {
				baseUrl: "",
				environment: "test",
				publicKey: "",
				secretKey: "",
			},
		});

		expect(result.passed).toBe(false);
		expect(result.cases).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actual_tool: "knowledge_query",
					case_id: "wrong-tool-despite-public-source-card",
					decision_kind: "tool_call",
					required_source_covered: true,
					source_count: 1,
				}),
			]),
		);
		expect(result.score_items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "agent.tool_selection.correct",
					trace_id: "trace_wrong_tool",
					value: 0,
				}),
				expect.objectContaining({
					name: "public_web_search.source_policy.valid",
					trace_id: "trace_wrong_tool",
					value: 1,
				}),
			]),
		);
	});

	it("records provider failures in the local bakeoff summary before rethrowing", async () => {
		const fetchImpl: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/api/chat/requests/stream")) {
				return new Response(
					sse("request.failed", {
						error: {
							code: "public_web_search_provider_failed",
							message: "provider timeout",
						},
						requestId: "req_failed",
						status: "failed",
						traceId: "trace_failed",
					}),
					{
						headers: { "content-type": "text/event-stream" },
						status: 200,
					},
				);
			}
			throw new Error(`unexpected fetch: ${url}`);
		};

		await expect(
			runPublicWebSearchAgentEval({
				assetPayload: {
					cases: [
						{
							case_id: "provider-fails",
							expected_tool: "public_web_search",
							min_sources: 1,
							query: "校园网密码怎么改",
							required_allowed_url_patterns: [
								"https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/*",
							],
							required_answer_facts: [],
						},
					],
					eval_kinds: ["routing_tool_selection", "source_quality", "answer_grounding"],
					schema_version: "public_web_search_agent_eval.v1",
				},
				baseUrl: "https://campus-staging.example",
				cookieHeader: "session=abc",
				dryRun: true,
				environment: "test",
				fetchImpl,
				model: "sonar",
				provider: "perplexity_compatible",
				providerProfileId: "provider_profile_public_web_search_compatible",
				settings: {
					baseUrl: "",
					environment: "test",
					publicKey: "",
					secretKey: "",
				},
			}),
		).rejects.toMatchObject({
			bakeoffSummary: expect.objectContaining({
				cost_projection_status: "unavailable",
				provider: "perplexity_compatible",
				provider_error_count: 1,
				provider_profile_id: "provider_profile_public_web_search_compatible",
				transport: "perplexity_search",
			}),
		});
	});

	it("records Linux.do public web search transport metadata", async () => {
		const fetchImpl: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/api/chat/requests/stream")) {
				return new Response(
					sse("request.accepted", {
						requestId: "req_linux_do",
						runId: "run_linux_do",
						status: "accepted",
						traceId: "trace_linux_do",
					}) +
						sse("request.completed", {
							answer: {
								conversation: { id: "conv_linux_do", messages: [] },
								result: {
									kind: "answer",
									requestId: "req_linux_do",
									text: "可参考中央民族大学上网指南。",
									traceId: "trace_linux_do",
								},
							},
							requestId: "req_linux_do",
							status: "completed",
							traceId: "trace_linux_do",
						}),
					{ headers: { "content-type": "text/event-stream" }, status: 200 },
				);
			}
			if (url.endsWith("/api/chat/runs/run_linux_do/steps")) {
				return runStepsResponse({
					available_tools: ["knowledge_query", "public_web_search"],
					conversation_id: "conv_linux_do",
					decision_kind: "tool_call",
					request_id: "req_linux_do",
					run_id: "run_linux_do",
					schema_version: "tool_trajectory.v1",
					selected_tool: "public_web_search",
					tool_calls: [
						{
							result_kind: "public_web_evidence",
							status: "completed",
							tool_call_id: "call_linux_do",
							tool_name: "public_web_search",
						},
					],
					trace_id: "trace_linux_do",
				});
			}
			if (url.endsWith("/api/chat/conversations/conv_linux_do")) {
				return jsonResponse({
					conversation: {
						id: "conv_linux_do",
						messages: [
							{
								kind: "answer",
								requestId: "req_linux_do",
								role: "assistant",
								structuredParts: [
									{
										sourceItems: [
											{
												primaryAction: {
													external: true,
													href: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
													label: "打开网页",
												},
												publisherLabel: "中央民族大学",
												snippet: "校园网用户名是学号。",
												title: "上网指南",
											},
										],
										type: "source_items",
									},
								],
								text: "可参考中央民族大学上网指南。",
							},
						],
					},
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		};

		const result = await runPublicWebSearchAgentEval({
			assetPayload: {
				cases: [
					{
						case_id: "linux-do-web-search",
						expected_tool: "public_web_search",
						min_sources: 1,
						query: "校园网密码怎么改",
						required_allowed_url_patterns: [
							"https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/*",
						],
						required_answer_facts: [],
					},
				],
				eval_kinds: ["routing_tool_selection", "source_quality", "answer_grounding"],
				schema_version: "public_web_search_agent_eval.v1",
			},
			baseUrl: "https://campus-staging.example",
			cookieHeader: "session=abc",
			dryRun: true,
			environment: "test",
			fetchImpl,
			model: "gpt-5-search-api-2025-10-14",
			provider: "linux_do",
			providerProfileId: "provider_profile_public_web_search_linux_do",
			settings: {
				baseUrl: "",
				environment: "test",
				publicKey: "",
				secretKey: "",
			},
		});

		expect(result).toMatchObject({
			model: "gpt-5-search-api-2025-10-14",
			provider: "linux_do",
			provider_profile_id: "provider_profile_public_web_search_linux_do",
			transport: "openai_chat_completions_web_search",
		});
	});
});
