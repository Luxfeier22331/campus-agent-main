import { expect, it, vi } from "vitest";

import type { SupervisorAdapterSuiteContext } from "./supervisor-adapter.test-support";

export function registerSupervisorAdapterRequestSuite(ctx: SupervisorAdapterSuiteContext): void {
	const { createActor, createContext, createSupervisorExecutionClient, readMockRequestBody } = ctx;

	it("sends canonical snake_case execution payload without legacy retrieval carrier fields", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					answer_text: "图书馆开放到 22:00。",
					confidence: "high",
					error: null,
					follow_up_question: "",
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }],
						},
					},
					selected_target: "rag-agent",
					status: "completed",
					trace_id: "trace_01HQ",
				}),
				{ status: 200 },
			),
		);
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const result = await client.execute({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			safetyIdentifier: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_01HQ",
			userGoal: "图书馆开放到几点？",
			versionQuery: {
				mode: "as_of",
				asOf: "2024-06-01",
			},
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://supervisor.internal/api/v1/answer",
			expect.objectContaining({
				headers: {
					baggage: "sentry-environment=test",
					"content-type": "application/json",
					"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
					"x-trace-id": "trace_01HQ",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			context: {
				actor: {
					cohort: "2024",
					departments: [],
					major: "历史学",
					principal_id: "principal_01HQ",
					principal_type: "student",
					program: "历史学强基计划",
					roles: ["student"],
					user_id: "user_01HQ",
				},
				authorization: {
					applicability_scope: "undergraduate",
					approval_state: "not_required",
					entitlement_groups: ["students"],
					entitlement_snapshot_id: "entitlements-2026-03-29",
					ownership_scopes: ["conversation:user_01HQ"],
					principal_id: "principal_01HQ",
					projection_source: "campus_identity",
					retrieval_filter: {
						entitlement_groups: ["students"],
						policy_projection_version: "phase1-authorization-projection-v1",
						visibility_level: "public",
						visibility_scope: "main",
					},
					visibility_scope: "main",
				},
				profile_memory: {
					items: [],
				},
				session: {
					confirmed_slots: [],
					turn_count: 0,
				},
			},
			conversation_id: "conv_01HQ",
			request_id: "req_01HQ",
			requested_capability: "knowledge",
			requested_scope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			version_query: {
				as_of: "2024-06-01",
				mode: "as_of",
			},
			safety_identifier: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			user_goal: "图书馆开放到几点？",
		});
		expect(result).toEqual({
			answerText: "图书馆开放到 22:00。",
			error: null,
			followUpQuestion: "",
			observability: null,
			result: {
				evidence: {
					sources: [{ doc_id: "handbook:library-hours" }],
				},
			},
			selectedTarget: "rag-agent",
			status: "completed",
			traceId: "trace_01HQ",
		});
	}, 15_000);
	it("opens the lifecycle SSE endpoint without parsing the event stream", async () => {
		const upstreamResponse = new Response(
			'event: execution.completed\ndata: {"status":"completed"}\n\n',
			{
				headers: { "content-type": "text/event-stream; charset=utf-8" },
				status: 200,
			},
		);
		const fetchImplementation = vi.fn().mockResolvedValue(upstreamResponse);
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		expect(client.executeStream).toBeTypeOf("function");
		const response = await client.executeStream?.({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_stream_01HQ",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_stream_01HQ",
			userGoal: "给我流式生命周期",
		});

		expect(response).toBe(upstreamResponse);
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://supervisor.internal/api/v1/answer/stream",
			expect.objectContaining({
				headers: {
					accept: "text/event-stream",
					baggage: "sentry-environment=test",
					"content-type": "application/json",
					"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
					"x-trace-id": "trace_stream_01HQ",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toMatchObject({
			conversation_id: "conv_01HQ",
			request_id: "req_stream_01HQ",
			user_goal: "给我流式生命周期",
		});
	});
}
