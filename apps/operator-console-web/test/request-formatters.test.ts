import { describe, expect, it } from "vitest";

import {
	buildRequestIntentEntries,
	buildRequestReplayEntries,
	buildRequestRuntimeRunEntries,
	buildRequestStepTrajectoryEntries,
	buildRequestWorkflowTraceEntries,
	CURRENT_RUNTIME_TARGET_OPTIONS,
	formatCapabilityLabel,
	formatIntentLaunchStateLabel,
	formatIntentNextActionLabel,
	formatIntentScopeClassLabel,
	formatIntentTaskKindLabel,
	formatSelectedCapabilityLabel,
} from "../src/panel/requests/request-formatters";

describe("request target formatters", () => {
	it("maps every current capability to a localized display label", () => {
		expect(formatSelectedCapabilityLabel("knowledge")).toBe("知识问答");
		expect(formatSelectedCapabilityLabel("navigation")).toBe("地图导航");
		expect(formatSelectedCapabilityLabel("campus_services")).toBe("校园服务");
		expect(formatSelectedCapabilityLabel("notice")).toBe("通知公告");
	});

	it("publishes current capability filter options as a closed set", () => {
		expect(CURRENT_RUNTIME_TARGET_OPTIONS).toEqual([
			{ label: "知识问答", value: "knowledge" },
			{ label: "地图导航", value: "navigation" },
			{ label: "校园服务", value: "campus_services" },
			{ label: "通知公告", value: "notice" },
		]);
	});
});

describe("request intent formatters", () => {
	it("maps current intent codes to localized display labels while preserving unknown codes", () => {
		expect(formatCapabilityLabel("knowledge")).toBe("知识问答");
		expect(formatCapabilityLabel("place_lookup")).toBe("地点查询");
		expect(formatCapabilityLabel("campus_services")).toBe("校园服务");
		expect(formatCapabilityLabel("notice")).toBe("通知公告");
		expect(formatCapabilityLabel("custom_capability")).toBe("custom_capability");

		expect(formatIntentTaskKindLabel("knowledge_lookup")).toBe("知识检索");
		expect(formatIntentTaskKindLabel("place_lookup")).toBe("地点查询");
		expect(formatIntentTaskKindLabel("campus_services_lookup")).toBe("服务查询");
		expect(formatIntentTaskKindLabel("notice_lookup")).toBe("通知查询");
		expect(formatIntentTaskKindLabel("unknown")).toBe("未知");
		expect(formatIntentTaskKindLabel("custom_task")).toBe("custom_task");

		expect(formatIntentLaunchStateLabel("open")).toBe("已开放");
		expect(formatIntentLaunchStateLabel("candidate_only")).toBe("候选观察");
		expect(formatIntentLaunchStateLabel("closed")).toBe("已关闭");
		expect(formatIntentLaunchStateLabel("custom_state")).toBe("custom_state");

		expect(formatIntentNextActionLabel("delegate")).toBe("委派执行");
		expect(formatIntentNextActionLabel("clarify")).toBe("请求澄清");
		expect(formatIntentNextActionLabel("approval_required")).toBe("需要审批");
		expect(formatIntentNextActionLabel("out_of_scope")).toBe("范围外");
		expect(formatIntentNextActionLabel("rejected")).toBe("拒绝");
		expect(formatIntentNextActionLabel("custom_action")).toBe("custom_action");

		expect(formatIntentScopeClassLabel("in_scope")).toBe("范围内");
		expect(formatIntentScopeClassLabel("out_of_scope")).toBe("范围外");
		expect(formatIntentScopeClassLabel("custom_scope")).toBe("custom_scope");
	});

	it("builds operator-facing intent rows from request observability intent summaries", () => {
		expect(
			buildRequestIntentEntries({
				ambiguityReason: null,
				ambiguitySignal: null,
				capability: "campus_services",
				classifierVersion: "deterministic-intent-v1",
				contextReferenceType: "selected_notice",
				contextResolutionState: "resolved",
				launchState: "open",
				missingSlots: [],
				nextAction: "delegate",
				policyReason: null,
				resolvedSlots: { notice_id: "notice:2026-spring-break" },
				routingConfidence: "high",
				schemaVersion: "intent-schema-1.0.0",
				scopeClass: "in_scope",
				scopeReason: "explicit_requested_capability",
				taskKind: "campus_services_lookup",
			}),
		).toEqual([
			{ label: "识别能力", value: "校园服务" },
			{ label: "任务类型", value: "服务查询" },
			{ label: "开放状态", value: "已开放" },
			{ label: "下一步动作", value: "委派执行" },
			{ label: "范围判定", value: "范围内" },
			{ label: "范围原因", value: "显式请求能力" },
			{ label: "策略原因", value: "无" },
			{ label: "上下文解析", value: "已解析" },
			{ label: "上下文引用", value: "已选通知" },
			{ label: "路由置信度", value: "高" },
			{ label: "缺失槽位", value: "无" },
			{ label: "解析槽位", value: "notice_id=notice:2026-spring-break" },
			{ label: "意图数据版本", value: "intent-schema-1.0.0" },
			{ label: "分类器版本", value: "deterministic-intent-v1" },
		]);
	});

	it("omits intent rows when an old observability record has no intent summary", () => {
		expect(buildRequestIntentEntries(undefined)).toEqual([]);
	});
});

describe("request workflow trace formatters", () => {
	it("builds operator-facing rows from tool call summaries and version provenance", () => {
		expect(
			buildRequestWorkflowTraceEntries({
				contextResolution: { state: "not_follow_up" },
				directVsDelegateBranch: "direct",
				failCloseReason: null,
				guardrailOutcomes: { scope_gate: "allow" },
				handoff: {
					allowed_tools: ["transport_schedule_lookup", "service_status_lookup"],
					target: "campus_services",
				},
				planningOutcome: "preplanned",
				policyArtifactVersions: {
					intent_classifier: "go-runtime-policy-v2",
					intent_schema: "intent-schema-1.0.0",
				},
				routingFrame: { suggested_next_action: "delegate" },
				runtimeVersions: {
					bridge_contract: "supervisor_bridge_v6",
					supervisor_api_runtime: "go-runtime-control-plane-v1",
				},
				selectedCapability: "campus_services",
				selectedTools: ["service_status_lookup"],
				toolArgumentSummary: {
					safe_details: {
						agent_execution_projection: {
							projection_owner: "campus_services",
							selected_tool: "service_status_lookup",
							tool_selection_reason: "typed_payload_allowed_tool",
						},
						result_guardrail: {
							access_decision: "allowed",
							outcome: "source_backed",
							source_ref_count: 1,
						},
					},
					subject_query: "校园卡服务",
				},
				toolCallSummaries: [
					{
						business_outcome: "resolved_current",
						result_status: "completed",
						source_ids: ["notice:muc_internal_portal:353903"],
						tool_name: "service_status_lookup",
					},
				],
				traceSteps: [
					{
						outcome: "delegate",
						parent_step_id: "",
						span_kind: "runtime_policy",
						step_id: "runtime_policy",
					},
					{
						outcome: "completed",
						parent_step_id: "tool_call",
						result_status: "completed",
						span_kind: "finalization",
						step_id: "finalization",
					},
				],
			}),
		).toEqual([
			{ label: "工具序列", value: "service_status_lookup" },
			{ label: "工具调用", value: "service_status_lookup:completed/resolved_current" },
			{
				label: "处理选择",
				value: "service_status_lookup:typed_payload_allowed_tool",
			},
			{
				label: "结果检查",
				value: "source_backed/来源=1/授权=allowed",
			},
			{ label: "来源证据", value: "notice:muc_internal_portal:353903" },
			{ label: "拒绝保护来源", value: "无" },
			{
				label: "追踪步骤",
				value: "runtime_policy(runtime_policy):delegate · finalization(finalization):completed",
			},
			{
				label: "运行版本",
				value:
					"bridge_contract=supervisor_bridge_v6 · supervisor_api_runtime=go-runtime-control-plane-v1",
			},
			{
				label: "策略版本",
				value: "intent_classifier=go-runtime-policy-v2 · intent_schema=intent-schema-1.0.0",
			},
		]);
	});

	it("keeps workflow trace rows compatible with old records", () => {
		expect(buildRequestWorkflowTraceEntries(undefined)).toEqual([]);
	});

	it("does not expose raw supervisor bridge or provider payload keys", () => {
		const rows = buildRequestWorkflowTraceEntries({
			contextResolution: {},
			directVsDelegateBranch: "delegate",
			failCloseReason: null,
			guardrailOutcomes: {},
			handoff: {},
			planningOutcome: "preplanned",
			policyArtifactVersions: {
				intent_policy: "intent-policy.v1",
				provider_raw_response: "secret-provider-response",
			},
			routingFrame: {},
			runtimeVersions: {
				bridge_contract: "supervisor_bridge_v6",
				supervisor_bridge_v6_raw_payload: "secret-bridge-payload",
			},
			selectedCapability: "knowledge",
			selectedTools: ["retrieval.query"],
			toolArgumentSummary: {
				safe_details: {
					agent_execution_projection: {
						projection_owner: "knowledge",
						selected_tool: "retrieval.query",
						tool_selection_reason: "typed_payload_allowed_tool",
					},
					raw_prompt: "secret-prompt",
				},
			},
			toolCallSummaries: [],
			traceSteps: [],
		});

		const rendered = JSON.stringify(rows);
		expect(rendered).toContain("bridge_contract=supervisor_bridge_v6");
		expect(rendered).toContain("intent_policy=intent-policy.v1");
		expect(rendered).not.toContain("secret-bridge-payload");
		expect(rendered).not.toContain("secret-provider-response");
		expect(rendered).not.toContain("secret-prompt");
	});
});

describe("request durable runtime formatters", () => {
	it("builds operator-facing durable run rows without raw event payloads", () => {
		const rows = buildRequestRuntimeRunEntries({
			eventSummary: {
				eventCount: 2,
				latestEvent: {
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					sequence: 2,
					visibility: "browser",
				},
				terminalEvent: {
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					sequence: 2,
					visibility: "browser",
				},
				visibilityCounts: {
					browser: 1,
					eval: 0,
					internal: 1,
					panel: 0,
				},
			},
			run: {
				conversationId: "conv_01HQ",
				phase: "completed",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				status: "completed",
				terminalReason: "answer_completed",
				traceId: "trace_01HQ",
			},
		});

		expect(rows).toEqual([
			{ label: "运行 ID", value: "run_01HQ" },
			{ label: "运行状态", value: "completed" },
			{ label: "运行阶段", value: "completed" },
			{ label: "终态原因", value: "answer_completed" },
			{ label: "事件数", value: "2" },
			{
				label: "最近事件",
				value: "2 · finalization.completed · browser · 2026年6月4日 09:02",
			},
			{
				label: "终态事件",
				value: "2 · finalization.completed · browser · 2026年6月4日 09:02",
			},
			{ label: "事件可见范围", value: "内部记录=1 · 面板=0 · 用户侧=1 · 评测=0" },
		]);
		expect(JSON.stringify(rows)).not.toContain("payload");
	});

	it("keeps durable run rows compatible with non-durable historical records", () => {
		expect(buildRequestRuntimeRunEntries(undefined)).toEqual([]);
		expect(buildRequestRuntimeRunEntries(null)).toEqual([]);
	});

	it("formats primary agent trajectory diagnostics from sanitized step summaries", () => {
		const entries = buildRequestStepTrajectoryEntries({
			attemptCount: 1,
			resultCount: 1,
			steps: [
				{
					attemptCount: 1,
					agentSdkTraceRef: "trace://openai-agents/trace-agent-001",
					agentSelectedTools: ["knowledge_query"],
					agentTerminalReason: "tool_selected",
					agentToolResultRefs: ["agent-runtime://run-001/tools/knowledge_query"],
					capability: "primary_agent",
					cancelOutcome: null,
					durationMs: 420,
					estimatedCostMicrousd: 12,
					failCloseReason: null,
					inputTokens: 10,
					lateCompletionOutcome: null,
					latestResultRef: "projection://runs/run-001/agent/primary/result",
					modelName: "gpt-5.5",
					modelProvider: "openai",
					outputTokens: 8,
					providerRequestRef: null,
					queueWaitMs: 5,
					replanReason: null,
					resultCount: 1,
					status: "completed",
					stepId: "agent.primary",
					stepKind: "agent",
					taskQueue: "campus-agent.activity.agent",
					timeoutOutcome: null,
					workerId: "test:agent:001",
				},
			],
		});

		expect(entries[1]).toMatchObject({
			kind: "step",
			stepId: "agent.primary",
			diagnostics: expect.arrayContaining([
				"模型代理终态=tool_selected",
				"模型代理工具=knowledge_query",
				"模型代理追踪=trace://openai-agents/trace-agent-001",
				"工具结果=agent-runtime://run-001/tools/knowledge_query",
			]),
		});
	});

	it("formats operator step trajectory export with provider and token metadata", () => {
		const entries = buildRequestStepTrajectoryEntries({
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			schemaVersion: "operator_step_trajectory.v1",
			traceId: "trace_01HQ",
			steps: [
				{
					attemptCount: 1,
					capability: "knowledge",
					cancelOutcome: "not_requested",
					durationMs: 100,
					estimatedCostMicrousd: 321,
					failCloseReason: null,
					inputTokens: 120,
					lateCompletionOutcome: "ignored_after_timeout",
					latestResultRef: "projection://runs/run_01HQ/synthesis",
					modelName: "gpt-5-mini",
					modelProvider: "openai",
					outputTokens: 42,
					projectionRefs: ["projection://runs/run_01HQ/synthesis"],
					providerRequestRef: "provider://requests/req_001",
					queueWaitMs: 25,
					replanReason: "bounded_replan_after_provider_timeout",
					resultCount: 1,
					status: "completed",
					stepId: "synthesis",
					stepKind: "synthesis",
					taskQueue: "campus-agent.activity.knowledge.synthesis",
					terminalReason: null,
					timeoutOutcome: "provider_timeout",
					toolName: null,
					toolStatus: null,
					workerId: "staging:activity-knowledge-synthesis:001",
				},
			],
		});

		expect(entries[1]).toMatchObject({
			kind: "step",
			model: "openai/gpt-5-mini",
			providerRequestRef: "provider://requests/req_001",
			tokenCost: "输入/输出 120/42 · 约 $0.0003 USD",
		});
	});

	it("groups operator step diagnostics by runtime outcome type", () => {
		const entries = buildRequestStepTrajectoryEntries({
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			schemaVersion: "operator_step_trajectory.v1",
			traceId: "trace_01HQ",
			steps: [
				{
					attemptCount: 1,
					capability: "knowledge",
					cancelOutcome: "activity_context_canceled",
					durationMs: 100,
					estimatedCostMicrousd: 0,
					failCloseReason: "current_state_unverifiable",
					inputTokens: 0,
					lateCompletionOutcome: "ignored_after_cancel",
					latestResultRef: "projection://runs/run_01HQ/synthesis",
					modelName: null,
					modelProvider: null,
					outputTokens: 0,
					projectionRefs: ["projection://runs/run_01HQ/synthesis"],
					providerRequestRef: null,
					queueWaitMs: 25,
					replanReason: "bounded_replan_after_provider_timeout",
					resultCount: 1,
					status: "canceled",
					stepId: "synthesis",
					stepKind: "synthesis",
					taskQueue: "campus-agent.activity.knowledge.synthesis",
					terminalReason: "user_canceled",
					timeoutOutcome: "provider_timeout",
					toolName: null,
					toolStatus: null,
					workerId: "staging:activity-knowledge-synthesis:001",
				},
			],
		});

		expect(entries[1]).toMatchObject({
			diagnosticGroups: [
				{
					kind: "runtime",
					items: expect.arrayContaining([
						"取消=activity_context_canceled",
						"超时=provider_timeout",
						"迟到完成=ignored_after_cancel",
					]),
				},
				{
					kind: "terminal",
					items: expect.arrayContaining([
						"终态=user_canceled",
						"拒绝保护=current_state_unverifiable",
					]),
				},
				{
					kind: "replan",
					items: ["重规划=bounded_replan_after_provider_timeout"],
				},
			],
		});
	});
});

describe("request replay formatters", () => {
	it("builds operator-facing replay rows from retrieval, answer, and prompt summaries", () => {
		expect(
			buildRequestReplayEntries({
				answerQuality: {
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					claimSupportSummary: {
						supportedClaims: 2,
						totalClaims: 3,
						unsupportedClaimTypes: ["deadline"],
						unsupportedClaims: 1,
						unsupportedFields: ["deadline_claims"],
					},
					freshnessFailClosed: false,
					groundingDowngraded: true,
					groundingVerdict: "partial",
					policyReason: null,
				},
				context: {
					applicabilityScope: "undergraduate",
					entitlementGroups: ["students"],
					entitlementSnapshotId: "ent_01HQ",
					policyProjectionVersion: "phase1-authorization-projection-v1",
					principalType: "student",
					visibilityScope: "main",
				},
				execution: {
					errorCode: null,
					failClosed: false,
					refusalClass: null,
					scopeClass: "in_scope",
					semanticOutcome: "answered",
					status: "completed",
				},
				prompt: {
					id: "rag_answer_v1",
					runtimeDetail: null,
					runtimeState: "ok",
					templateSha256: "0123456789abcdef",
					version: "v1",
				},
				retrieval: {
					adequacyReason: "enough evidence",
					adequacyVerdict: "sufficient",
					candidateCount: 4,
					emptyRecall: false,
					plan: {
						planId: "student_rules:current",
						queryMode: "current",
						replanCount: 0,
						stepActivities: [],
						terminalState: "completed",
					},
					retrievalAttempted: true,
					retrievedSourceCount: 2,
					sourceTraceCounts: {
						retrieved: 2,
						supporting: 1,
					},
				},
				routing: {
					requestedCapability: "knowledge",
					requestedScope: { collection: "student_rules", corpus: "regulations" },
					resolvedScope: { collection: "student_rules", corpus: "regulations" },
					selectedCapability: "knowledge",
				},
			}),
		).toEqual([
			{ label: "检索充分性", value: "sufficient" },
			{ label: "检索原因", value: "enough evidence" },
			{ label: "检索计划", value: "student_rules:current · current · completed" },
			{ label: "来源轨迹", value: "召回 2 · 支撑 1" },
			{ label: "声明支撑", value: "2/3 支撑 · 1 未支撑" },
			{ label: "证据支撑", value: "partial · 证据受限" },
			{ label: "提示配置", value: "rag_answer_v1@v1 · ok" },
			{ label: "执行语义", value: "answered" },
		]);
	});

	it("keeps replay formatter compatible with older observability records", () => {
		expect(buildRequestReplayEntries(undefined)).toEqual([]);
	});

	it("shows unknown instead of not downgraded when grounding downgrade state is absent", () => {
		expect(
			buildRequestReplayEntries({
				answerQuality: {
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					claimSupportSummary: null,
					freshnessFailClosed: false,
					groundingDowngraded: null,
					groundingVerdict: "passed",
					policyReason: null,
				},
			}),
		).toContainEqual({ label: "证据支撑", value: "passed · 未知" });
	});
});
