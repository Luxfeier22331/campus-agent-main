import { describe, expect, it } from "vitest";

import {
	buildRequestIntentEntries,
	buildRequestReplayEntries,
	CURRENT_RUNTIME_TARGET_OPTIONS,
	formatCapabilityLabel,
	formatIntentLaunchStateLabel,
	formatIntentNextActionLabel,
	formatIntentScopeClassLabel,
	formatIntentTaskKindLabel,
	formatSelectedTargetLabel,
} from "../src/panel/requests/request-formatters";

describe("request target formatters", () => {
	it("maps every current runtime target to a localized display label", () => {
		expect(formatSelectedTargetLabel("rag-agent")).toBe("检索专家");
		expect(formatSelectedTargetLabel("navigation-agent")).toBe("导航能力");
		expect(formatSelectedTargetLabel("campus-services-agent")).toBe("校园服务");
		expect(formatSelectedTargetLabel("notice-agent")).toBe("通知能力");
	});

	it("publishes current runtime target filter options as a closed set", () => {
		expect(CURRENT_RUNTIME_TARGET_OPTIONS).toEqual([
			{ label: "检索专家", value: "rag-agent" },
			{ label: "导航能力", value: "navigation-agent" },
			{ label: "校园服务", value: "campus-services-agent" },
			{ label: "通知能力", value: "notice-agent" },
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
			{ label: "意图 Schema", value: "intent-schema-1.0.0" },
			{ label: "分类器版本", value: "deterministic-intent-v1" },
		]);
	});

	it("omits intent rows when an old observability record has no intent summary", () => {
		expect(buildRequestIntentEntries(undefined)).toEqual([]);
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
					selectedTarget: "rag-agent",
				},
			}),
		).toEqual([
			{ label: "检索充分性", value: "sufficient" },
			{ label: "检索原因", value: "enough evidence" },
			{ label: "检索计划", value: "student_rules:current · current · completed" },
			{ label: "来源轨迹", value: "召回 2 · 支撑 1" },
			{ label: "声明支撑", value: "2/3 支撑 · 1 未支撑" },
			{ label: "Grounding", value: "partial · 已降级" },
			{ label: "Prompt", value: "rag_answer_v1@v1 · ok" },
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
		).toContainEqual({ label: "Grounding", value: "passed · 未知" });
	});
});
