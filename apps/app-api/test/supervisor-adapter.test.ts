// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createSupervisorExecutionClient,
	SupervisorTransportError,
} from "../src/modules/integration/supervisor";

function createActor() {
	return {
		cohort: "2024",
		departments: [],
		major: "历史学",
		principalId: "principal_01HQ",
		principalType: "student" as const,
		program: "历史学强基计划",
		roles: ["student"],
		userId: "user_01HQ",
	};
}

function createAuthorization() {
	return {
		applicabilityScope: "undergraduate",
		approvalState: "not_required",
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements-2026-03-29",
		ownershipScopes: ["conversation:user_01HQ"],
		principalId: "principal_01HQ",
		projectionSource: "campus_identity" as const,
		retrievalFilter: {
			entitlementGroups: ["students"],
			policyProjectionVersion: "phase1-authorization-projection-v1",
			visibilityLevel: "public",
			visibilityScope: "main",
		},
		visibilityScope: "main",
	};
}

function createContext(turnCount = 0) {
	return {
		actor: createActor(),
		authorization: createAuthorization(),
		profileMemory: {
			items: [],
		},
		session: {
			confirmedSlots: [],
			turnCount,
		},
	};
}

function readMockRequestBody(fetchImplementation: ReturnType<typeof vi.fn>, index: number): string {
	const body = fetchImplementation.mock.calls[index]?.[1]?.body;
	if (typeof body !== "string") {
		throw new Error(`Missing request body for call ${index}`);
	}
	return body;
}

describe("supervisor execution adapter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("sends canonical snake_case execution payload without legacy retrieval carrier fields", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					answer_text: "图书馆开放到 22:00。",
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

	it("ignores legacy target fallback and only trusts selected_target", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							answer_text: "图书馆开放到 22:00。",
							error: null,
							follow_up_question: "",
							result: null,
							status: "completed",
							target: "rag-agent",
							trace_id: "trace_01HQ",
						}),
						{ status: 200 },
					),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "图书馆开放到几点？",
			}),
		).resolves.toEqual({
			answerText: "图书馆开放到 22:00。",
			error: null,
			followUpQuestion: "",
			observability: null,
			result: null,
			selectedTarget: null,
			status: "completed",
			traceId: "trace_01HQ",
		});
	});

	it("preserves approval_required without forcing a specialist target", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							answer_text: "该请求涉及需要人工确认的操作，必须先经过审批。",
							error: null,
							follow_up_question: "",
							result: null,
							selected_target: null,
							status: "approval_required",
							trace_id: "trace_01HQ",
						}),
						{ status: 200 },
					),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(2),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "帮我提交奖学金申请",
			}),
		).resolves.toEqual({
			answerText: "该请求涉及需要人工确认的操作，必须先经过审批。",
			error: null,
			followUpQuestion: "",
			observability: null,
			result: null,
			selectedTarget: null,
			status: "approval_required",
			traceId: "trace_01HQ",
		});
	});

	it("parses typed request observability facts from the supervisor response", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							answer_text: "图书馆开放到 22:00。",
							error: null,
							follow_up_question: "",
							observability: {
								acl_decision: "allowed",
								acl_anomaly_code: null,
								cached_input_tokens: 120,
								candidate_count: 5,
								citation_count: 2,
								citation_expected: true,
								citation_missing: false,
								estimated_cost_microusd: 3810,
								fail_closed: false,
								input_tokens: 812,
								intent_capability: "knowledge",
								intent_classifier_version: "deterministic-intent-v1",
								intent_launch_state: "candidate_only",
								intent_next_action: "delegate",
								intent_policy_reason: null,
								intent_scope_class: "in_scope",
								intent_scope_reason: "structured_runtime_candidate_signal",
								intent_task_kind: "knowledge_lookup",
								model_name: "gpt-5.2-mini",
								model_provider: "openai",
								output_tokens: 229,
								policy_reason: null,
								prompt_runtime_detail: "content_filter",
								prompt_runtime_state: "content_filter",
								prompt_trace: {
									model_name: "gpt-5.2-mini",
									model_provider: "openai",
									output_schema_version: "v1",
									prompt_id: "rag_answer_v1",
									prompt_version: "v1",
									template_sha256:
										"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
									variables_schema_version: "v1",
								},
								refusal_class: null,
								retrieved_source_count: 2,
								retrieval_attempted: true,
								scope_class: "in_scope",
								semantic_outcome: "grounded_answer",
							},
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
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "图书馆开放到几点？",
			}),
		).resolves.toEqual({
			answerText: "图书馆开放到 22:00。",
			error: null,
			followUpQuestion: "",
			observability: {
				aclAnomalyCode: null,
				aclDecision: "allowed",
				cachedInputTokens: 120,
				candidateCount: 5,
				citationCount: 2,
				citationExpected: true,
				citationMissing: false,
				estimatedCostMicrousd: 3810,
				failClosed: false,
				inputTokens: 812,
				intentCapability: "knowledge",
				intentClassifierVersion: "deterministic-intent-v1",
				intentLaunchState: "candidate_only",
				intentNextAction: "delegate",
				intentPolicyReason: null,
				intentScopeClass: "in_scope",
				intentScopeReason: "structured_runtime_candidate_signal",
				intentTaskKind: "knowledge_lookup",
				modelName: "gpt-5.2-mini",
				modelProvider: "openai",
				outputTokens: 229,
				policyReason: null,
				promptRuntimeDetail: "content_filter",
				promptRuntimeState: "content_filter",
				promptTrace: {
					modelName: "gpt-5.2-mini",
					modelProvider: "openai",
					outputSchemaVersion: "v1",
					promptId: "rag_answer_v1",
					promptVersion: "v1",
					templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
					variablesSchemaVersion: "v1",
				},
				refusalClass: null,
				retrievedSourceCount: 2,
				retrievalAttempted: true,
				scopeClass: "in_scope",
				semanticOutcome: "grounded_answer",
			},
			result: {
				evidence: {
					sources: [{ doc_id: "handbook:library-hours" }],
				},
			},
			selectedTarget: "rag-agent",
			status: "completed",
			traceId: "trace_01HQ",
		});
	});

	it("preserves curriculum requested scope while exposing internal course_facts evidence from supervisor response", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					answer_text:
						"根据培养方案和课程教学计划，习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)；当前还不能稳定确认开课学院。",
					error: null,
					follow_up_question: "",
					result: {
						evidence: {
							collection: "course_facts",
							corpus: "curriculum",
							sources: [
								{
									collection: "course_facts",
									doc_id: "curriculum:中央民族大学通识课程思想政治理论课教学计划",
								},
							],
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
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			traceId: "trace_01HQ",
			userGoal: "习概哪个学院开，第几学期开",
		});

		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toMatchObject({
			requested_scope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			user_goal: "习概哪个学院开，第几学期开",
		});
		expect(result).toMatchObject({
			answerText:
				"根据培养方案和课程教学计划，习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)；当前还不能稳定确认开课学院。",
			selectedTarget: "rag-agent",
			status: "completed",
			result: {
				evidence: {
					collection: "course_facts",
					corpus: "curriculum",
					sources: [
						{
							collection: "course_facts",
							doc_id: "curriculum:中央民族大学通识课程思想政治理论课教学计划",
						},
					],
				},
			},
			traceId: "trace_01HQ",
		});
	});

	it("preserves curriculum typed diagnostics fields from supervisor response", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							answer_text: "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
							error: null,
							follow_up_question: "",
							result: {
								diagnostics: {
									resolved_entity_type: "program",
									resolved_program_family_title: "民族班",
									rewritten_query: "法学民族实验班培养方案里第四学期有什么课",
									session_program_family: "民族实验班",
									session_program: "法学民族实验班",
									session_semester: "第四学期",
								},
								evidence: {
									sources: [
										{
											doc_id: "curriculum:法学（民族实验班）本科人才培养方案",
										},
									],
								},
							},
							selected_target: "rag-agent",
							status: "completed",
							trace_id: "trace_01HQ",
						}),
						{ status: 200 },
					),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				requestedCapability: "knowledge",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
				traceId: "trace_01HQ",
				userGoal: "法学民族班培养方案里大二下有什么课",
			}),
		).resolves.toEqual(
			expect.objectContaining({
				result: {
					diagnostics: {
						resolved_entity_type: "program",
						resolved_program_family_title: "民族班",
						rewritten_query: "法学民族实验班培养方案里第四学期有什么课",
						session_program_family: "民族实验班",
						session_program: "法学民族实验班",
						session_semester: "第四学期",
					},
					evidence: {
						sources: [
							{
								doc_id: "curriculum:法学（民族实验班）本科人才培养方案",
							},
						],
					},
				},
			}),
		);
	});

	it("raises a typed transport error for non-200 upstream responses", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							error: {
								code: "unauthorized",
								message: "Invalid shared secret.",
								retryable: false,
							},
						}),
						{ status: 502 },
					),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "图书馆开放到几点？",
			}),
		).rejects.toBeInstanceOf(SupervisorTransportError);
	});

	it("raises execution_timeout when the supervisor call exceeds the timeout budget", async () => {
		vi.useFakeTimers();
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
				SUPERVISOR_API_TIMEOUT_MS: "25",
			},
			{
				fetchImplementation: vi
					.fn()
					.mockImplementation(() => new Promise<Response>(() => undefined)),
			},
		);

		const pending = client.execute({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			traceId: "trace_01HQ",
			userGoal: "图书馆开放到几点？",
		});

		const assertion = expect(pending).rejects.toMatchObject({
			code: "execution_timeout",
			retryable: true,
			status: 504,
		});

		await vi.advanceTimersByTimeAsync(25);
		await assertion;
	});

	it("gives eval_benchmark requests a longer timeout budget than the default chat ceiling", async () => {
		vi.useFakeTimers();
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
				SUPERVISOR_API_TIMEOUT_MS: "25",
			},
			{
				fetchImplementation: vi
					.fn()
					.mockImplementation(() => new Promise<Response>(() => undefined)),
			},
		);

		const pending = client.execute({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			surface: "eval_benchmark",
			traceId: "trace_01HQ",
			userGoal: "图书馆开放到几点？",
		});

		await vi.advanceTimersByTimeAsync(25);
		await vi.advanceTimersByTimeAsync(1);
		const marker = Symbol("pending");
		expect(await Promise.race([pending.catch(() => "rejected"), Promise.resolve(marker)])).toBe(
			marker,
		);
		pending.catch(() => undefined);
	});

	it("raises supervisor_invalid_response when the upstream body is not valid json", async () => {
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response("not-json", {
						headers: {
							"content-type": "application/json",
						},
						status: 200,
					}),
				),
			},
		);

		await expect(
			client.execute({
				actor: createActor(),
				context: createContext(),
				conversationId: "conv_01HQ",
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
				userGoal: "图书馆开放到几点？",
			}),
		).rejects.toMatchObject({
			code: "supervisor_invalid_response",
			retryable: true,
			status: 502,
		});
	});

	it("omits requested_scope when app-api has not resolved the serving surface and parses resolved scope from observability", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					answer_text: "民族学本科人才培养方案总学分要求以培养方案正文为准。",
					error: null,
					follow_up_question: "",
					observability: {
						acl_decision: "allowed",
						citation_count: 1,
						citation_expected: true,
						citation_missing: false,
						resolved_scope_collection: "curriculum_plan",
						resolved_scope_corpus: "curriculum",
						retrieved_source_count: 1,
						retrieval_attempted: true,
					},
					result: {
						diagnostics: {
							resolved_scope_collection: "curriculum_plan",
							resolved_scope_corpus: "curriculum",
						},
						evidence: {
							sources: [{ doc_id: "curriculum:民族学本科人才培养方案" }],
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
			traceId: "trace_01HQ",
			userGoal: "民族学本科人才培养方案总学分要求是多少？",
		});

		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).not.toHaveProperty(
			"requested_scope",
		);
		expect(result.observability).toMatchObject({
			resolvedScopeCollection: "curriculum_plan",
			resolvedScopeCorpus: "curriculum",
		});
	});
});
