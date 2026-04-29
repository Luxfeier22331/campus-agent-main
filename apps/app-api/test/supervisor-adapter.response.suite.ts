import { expect, it, vi } from "vitest";

import type { SupervisorAdapterSuiteContext } from "./supervisor-adapter.test-support";

export function registerSupervisorAdapterResponseSuite(ctx: SupervisorAdapterSuiteContext): void {
	const {
		createActor,
		createContext,
		createSupervisorExecutionClient,
		readMockRequestBody,
		SupervisorTransportError,
	} = ctx;

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
	it("preserves approval_required without forcing an agent target", async () => {
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
								intent_ambiguity_reason: null,
								intent_ambiguity_signal: null,
								intent_capability: "knowledge",
								intent_classifier_version: "deterministic-intent-v1",
								intent_context_reference_type: "selected_notice",
								intent_context_resolution_state: "resolved",
								intent_launch_state: "candidate_only",
								intent_missing_slots: [],
								intent_next_action: "delegate",
								intent_policy_reason: null,
								intent_resolved_slots: {
									notice_id: "notice:2026-spring-break",
								},
								intent_routing_confidence: "high",
								intent_schema_version: "intent-schema-1.0.0",
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
								selected_tool: "service_status_lookup",
								tool_business_outcome: "resolved_current",
								tool_fail_close_reason: null,
								tool_historical_downgrade_reason: null,
							},
							workflow_trace_summary: {
								routing_frame: {
									suggested_next_action: "delegate",
								},
								context_resolution: {
									state: "not_follow_up",
								},
								planning_outcome: "preplanned",
								direct_vs_delegate_branch: "delegate",
								handoff: {
									target: "rag-agent",
									payload_kind: "retrieval.query",
								},
								selected_target: "rag-agent",
								selected_tools: ["retrieval.query"],
								tool_argument_summary: {
									collection: "student_rules",
								},
								guardrail_outcomes: {
									scope_gate: "allow",
								},
								fail_close_reason: null,
								runtime_versions: {
									"supervisor-api": "test",
								},
								policy_artifact_versions: {
									"intent-policy": "v1",
								},
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
				intentAmbiguityReason: null,
				intentAmbiguitySignal: null,
				intentCapability: "knowledge",
				intentClassifierVersion: "deterministic-intent-v1",
				intentContextReferenceType: "selected_notice",
				intentContextResolutionState: "resolved",
				intentLaunchState: "candidate_only",
				intentMissingSlots: [],
				intentNextAction: "delegate",
				intentPolicyReason: null,
				intentResolvedSlots: {
					notice_id: "notice:2026-spring-break",
				},
				intentRoutingConfidence: "high",
				intentSchemaVersion: "intent-schema-1.0.0",
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
				selectedTool: "service_status_lookup",
				toolBusinessOutcome: "resolved_current",
				toolFailCloseReason: null,
				toolHistoricalDowngradeReason: null,
			},
			workflowTraceSummary: {
				contextResolution: {
					state: "not_follow_up",
				},
				directVsDelegateBranch: "delegate",
				failCloseReason: null,
				guardrailOutcomes: {
					scope_gate: "allow",
				},
				handoff: {
					payload_kind: "retrieval.query",
					target: "rag-agent",
				},
				planningOutcome: "preplanned",
				policyArtifactVersions: {
					"intent-policy": "v1",
				},
				routingFrame: {
					suggested_next_action: "delegate",
				},
				runtimeVersions: {
					"supervisor-api": "test",
				},
				selectedTarget: "rag-agent",
				selectedTools: ["retrieval.query"],
				toolArgumentSummary: {
					collection: "student_rules",
				},
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
	it("drops workflow trace summaries containing raw camelCase debug keys", async () => {
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
							selected_target: "rag-agent",
							status: "completed",
							trace_id: "trace_01HQ",
							workflow_trace_summary: {
								direct_vs_delegate_branch: "delegate",
								selected_target: "rag-agent",
								selected_tools: ["retrieval.query"],
								tool_argument_summary: {
									rawPrompt: "do not persist",
								},
							},
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
}
