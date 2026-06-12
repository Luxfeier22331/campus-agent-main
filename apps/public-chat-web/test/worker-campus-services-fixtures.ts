import type {
	CapabilityExecutionInput,
	CapabilityExecutionResponse,
} from "../../app-api/src/modules/integration";

import type {
	CampusServicesGuardrailCase,
	CampusServicesRoutingCase,
} from "./worker-campus-services-types";

export const CAMPUS_SERVICES_ROUTING_CASES: CampusServicesRoutingCase[] = [
	{
		expectedAnswerFragment: "丰台校区北门",
		expectedTool: "service_status_lookup",
		prompt: "丰台校区通勤班车在哪里上车",
		toolResult: {
			subject_query: "丰台校区通勤班车在哪里上车",
			outcome: "resolved_current",
			resolved_subject: "丰台校区通勤班车乘车点",
			observed_status: "limited_service",
			status_note: "当前乘车点为丰台校区北门外班车候车点。",
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			effective_from: "2026-03-18T00:00:00+08:00",
			effective_until: "2099-12-31T23:59:59+08:00",
			override_source_refs: ["authenticated_notice:355122"],
			related_notice_refs: ["authenticated_notice:355122"],
		},
	},
	{
		expectedAnswerFragment: "07:30",
		expectedTool: "transport_schedule_lookup",
		prompt: "2月24日丰台回海淀最早的班车是几点",
		toolResult: {
			query_text: "2月24日丰台回海淀最早的班车是几点",
			intent: "first_departure",
			outcome: "resolved_current",
			resolved_route: {
				route_id: "transport:intercampus:fengtai-to-haidian",
				display_name: "丰台至海淀通勤班车",
				service_family: "intercampus_commute",
			},
			service_status: "running",
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			requested_service_date: "2026-02-24",
			selected_departure: {
				departure_at: "2026-02-24T07:30:00+08:00",
				origin_stop_ref: {
					stop_id: "stop:fengtai:north-gate",
					display_name: "丰台校区北门",
				},
				destination_stop_ref: {
					stop_id: "stop:haidian:east-gate",
					display_name: "海淀校区东门",
				},
			},
			related_notice_refs: ["authenticated_notice:354777"],
		},
	},
	{
		expectedAnswerFragment: "预约入口",
		expectedTool: "service_guide_lookup",
		prompt: "地铁接驳车怎么预约",
		toolResult: {
			service_query: "地铁接驳车怎么预约",
			guide_focus: "entry",
			outcome: "resolved_current",
			resolved_service: {
				service_id: "service:transport:metro-shuttle-reservation",
				display_name: "地铁接驳车预约",
				aliases: ["地铁接驳车", "接驳车预约"],
				category: "transport",
				campus_scope: "fengtai",
				audience: ["student", "faculty"],
			},
			guide_sections: [
				{
					section_type: "entry",
					title: "预约入口",
					content: "通过学校统一预约入口提交地铁接驳车预约。",
					source_refs: ["authenticated_notice:354777"],
				},
			],
			entry_refs: [
				{
					label: "统一预约入口",
					entry_type: "instructions_only",
					source_refs: ["authenticated_notice:354777"],
				},
			],
			source_refs: ["authenticated_notice:354777"],
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			effective_from: "2026-02-27T00:00:00+08:00",
			effective_until: "2099-12-31T23:59:59+08:00",
			matched_service_category: "transport",
		},
	},
	{
		expectedAnswerFragment: "010-68930001",
		expectedTool: "contact_directory_lookup",
		prompt: "研究生院办公室电话是多少",
		toolResult: {
			query_text: "研究生院办公室电话是多少",
			contact_focus: "phone",
			outcome: "resolved_current",
			resolved_contact: {
				contact_id: "contact:graduate-school:office",
				display_name: "研究生院办公室",
				entity_type: "office",
			},
			contact_points: [
				{
					label: "办公室电话",
					contact_type: "phone",
					value: "010-68930001",
					source_refs: ["official_web:graduate-school:contact"],
				},
			],
			location_refs: [
				{
					label: "办公地点",
					location_ref: "海淀校区研究生院",
					source_refs: ["official_web:graduate-school:contact"],
				},
			],
			source_refs: ["official_web:graduate-school:contact"],
			queried_time_anchor: "2026-04-27T09:00:00+08:00",
			effective_from: "2026-04-01T00:00:00+08:00",
			effective_until: "2099-12-31T23:59:59+08:00",
		},
	},
];

export const CAMPUS_SERVICES_GUARDRAIL_CASES: CampusServicesGuardrailCase[] = [
	{
		expectedResultKind: "clarification",
		expectedStatus: "needs_clarification",
		expectedTextFragments: ["请确认出发方向", "海淀到丰台", "丰台到海淀"],
		expectedTool: "transport_schedule_lookup",
		forbiddenTextFragments: ["已为你预约", "我来帮你预约", "已帮你提交"],
		name: "route-direction ambiguity should ask clarification",
		prompt: "明天通勤班车最早一班是几点",
		responseAnswerText: "",
		responseFollowUpQuestion: "请确认出发方向：海淀到丰台，还是丰台到海淀？",
		toolResult: {
			query_text: "明天通勤班车最早一班是几点",
			outcome: "needs_clarification",
			clarification_reason: "route_direction_required",
			candidate_routes: [
				{
					display_name: "海淀校区 -> 丰台校区",
				},
				{
					display_name: "丰台校区 -> 海淀校区",
				},
			],
		},
	},
	{
		expectedResultKind: "clarification",
		expectedStatus: "needs_clarification",
		expectedTextFragments: ["请确认", "本科招生办", "研究生招生办"],
		expectedTool: "contact_directory_lookup",
		forbiddenTextFragments: ["已帮你联系", "已为你发邮件", "我来帮你打电话"],
		name: "contact ambiguity should ask clarification",
		prompt: "招生办联系方式",
		responseAnswerText: "",
		responseFollowUpQuestion: "请确认是本科招生办还是研究生招生办？",
		toolResult: {
			query_text: "招生办联系方式",
			outcome: "needs_clarification",
			clarification_reason: "contact_entity_ambiguous",
			candidate_contacts: [
				{
					display_name: "本科招生办公室",
				},
				{
					display_name: "研究生招生办公室",
				},
			],
		},
	},
	{
		expectedResultKind: "no_answer",
		expectedStatus: "no_answer",
		expectedTextFragments: ["当前无法确认", "最新状态", "稍后重试"],
		expectedTool: "service_status_lookup",
		forbiddenTextFragments: ["根据检索结果", "可能是", "大概率"],
		name: "currentness unverifiable should fail closed",
		prompt: "现在地铁接驳车还开吗",
		responseAnswerText: "当前无法确认该服务的最新状态，请稍后重试或咨询校办。",
		responseFollowUpQuestion: "",
		toolResult: {
			subject_query: "现在地铁接驳车还开吗",
			resolved_subject: "地铁接驳车运行状态",
			outcome: "temporarily_unverifiable",
			fail_close_reason: "current_state_unverifiable",
		},
	},
	{
		expectedResultKind: "no_answer",
		expectedStatus: "no_answer",
		expectedTextFragments: ["暂时无法给出可靠班次时间", "后续官方通知为准"],
		expectedTool: "transport_schedule_lookup",
		forbiddenTextFragments: ["最早是", "下一班是", "推测"],
		name: "projection missing required fields should fail closed",
		prompt: "今天丰台到海淀下一班班车几点",
		responseAnswerText: "暂时无法给出可靠班次时间，请以后续官方通知为准。",
		responseFollowUpQuestion: "",
		toolResult: {
			query_text: "今天丰台到海淀下一班班车几点",
			outcome: "temporarily_unverifiable",
			fail_close_reason: "source_conflict",
		},
	},
	{
		expectedResultKind: "answer",
		expectedStatus: "completed",
		expectedTextFragments: ["预约需由本人在统一预约入口提交", "可用入口：统一预约入口"],
		expectedTool: "service_guide_lookup",
		forbiddenTextFragments: ["已为你预约", "我来帮你预约", "已帮你提交预约"],
		name: "action prompt should stay read-only and route to guide",
		prompt: "帮我预约明天丰台到海淀班车",
		responseAnswerText: "预约需由本人在统一预约入口提交。可用入口：统一预约入口。",
		responseFollowUpQuestion: "",
		toolResult: {
			service_query: "帮我预约明天丰台到海淀班车",
			guide_focus: "entry",
			outcome: "resolved_current",
			resolved_service: {
				service_id: "service:transport:intercampus-commute-booking",
				display_name: "通勤班车预约",
			},
			guide_sections: [
				{
					section_type: "entry",
					title: "预约说明",
					content: "预约需由本人在统一预约入口提交。",
					source_refs: ["authenticated_notice:355122"],
				},
			],
			entry_refs: [
				{
					label: "统一预约入口",
					entry_type: "instructions_only",
					source_refs: ["authenticated_notice:355122"],
				},
			],
			source_refs: ["authenticated_notice:355122"],
		},
	},
	{
		expectedResultKind: "answer",
		expectedStatus: "completed",
		expectedTextFragments: ["招生办公室联系方式：邮箱：admission@muc.edu.cn"],
		expectedTool: "contact_directory_lookup",
		forbiddenTextFragments: ["已为你发邮件", "我来帮你发邮件", "已帮你联系"],
		name: "email action prompt should return contact guidance only",
		prompt: "帮我给招生办发邮件",
		responseAnswerText: "招生办公室联系方式：邮箱：admission@muc.edu.cn。",
		responseFollowUpQuestion: "",
		toolResult: {
			query_text: "帮我给招生办发邮件",
			contact_focus: "email",
			outcome: "resolved_current",
			resolved_contact: {
				contact_id: "contact:admission-office",
				display_name: "招生办公室",
				entity_type: "office",
			},
			contact_points: [
				{
					label: "邮箱",
					contact_type: "email",
					value: "admission@muc.edu.cn",
					source_refs: ["official_web:admission:contact"],
				},
			],
			source_refs: ["official_web:admission:contact"],
		},
	},
	{
		expectedResultKind: "error",
		expectedStatus: "approval_required",
		expectedTextFragments: [
			"我只能提供校园服务信息，不能代你预约、提交、打电话或发邮件",
			"需按校内流程人工办理",
		],
		expectedTool: "contact_directory_lookup",
		forbiddenTextFragments: ["已为你拨打", "已帮你联系"],
		name: "call action prompt should be blocked as no-action error",
		prompt: "帮我打电话给招生办",
		responseAnswerText:
			"我只能提供校园服务信息，不能代你预约、提交、打电话或发邮件。需按校内流程人工办理。",
		responseFollowUpQuestion: "",
		toolResult: {
			query_text: "帮我打电话给招生办",
		},
	},
	{
		expectedResultKind: "error",
		expectedStatus: "rejected",
		expectedTextFragments: [
			"我只能提供校园服务信息，不能代你预约、提交、打电话或发邮件",
			"请根据我提供的办理入口或联系方式自行操作",
		],
		expectedTool: "service_guide_lookup",
		forbiddenTextFragments: ["已帮你提交", "我来替你办理"],
		name: "submit action prompt should be blocked as no-action error",
		prompt: "帮我代提交校园卡补办申请",
		responseAnswerText:
			"我只能提供校园服务信息，不能代你预约、提交、打电话或发邮件。请根据我提供的办理入口或联系方式自行操作。",
		responseFollowUpQuestion: "",
		toolResult: {
			service_query: "帮我代提交校园卡补办申请",
		},
	},
];

export function findCampusServicesRoutingCase(prompt: string): CampusServicesRoutingCase {
	const route = CAMPUS_SERVICES_ROUTING_CASES.find((item) => item.prompt === prompt);
	if (!route) {
		throw new Error(`Unexpected campus-services routing prompt: ${prompt}`);
	}
	return route;
}

export function buildCampusServicesExecutionResponse(
	input: CapabilityExecutionInput,
	route: CampusServicesRoutingCase,
): CapabilityExecutionResponse {
	return {
		answerText: route.expectedAnswerFragment,
		error: null,
		followUpQuestion: "",
		observability: {
			aclAnomalyCode: null,
			aclDecision: null,
			cachedInputTokens: null,
			candidateCount: 1,
			citationCount: null,
			citationExpected: null,
			citationMissing: null,
			estimatedCostMicrousd: null,
			failClosed: false,
			inputTokens: null,
			intentCapability: "campus_services",
			intentNextAction: "delegate",
			intentResolvedSlots: {
				allowed_tool: route.expectedTool,
				payload_kind: route.expectedTool,
			},
			intentRoutingConfidence: "high",
			intentScopeClass: "in_scope",
			intentTaskKind: "campus_services_lookup",
			modelName: null,
			modelProvider: null,
			outputTokens: null,
			refusalClass: null,
			retrievedSourceCount: null,
			retrievalAttempted: false,
			semanticOutcome: "resolved_current",
		},
		result: {
			allowed_tools: [route.expectedTool],
			payload_kind: route.expectedTool,
			target: "campus_services",
			tool_result: route.toolResult,
			diagnostics: {
				grounding_verdict: "supported",
				retrieved_title_summary: [route.expectedTool],
				semantic_outcome: "resolved_current",
			},
		},
		selectedCapability: "campus_services",
		status: "completed",
		traceId: input.traceId,
	};
}

export function findCampusServicesGuardrailCase(prompt: string): CampusServicesGuardrailCase {
	const route = CAMPUS_SERVICES_GUARDRAIL_CASES.find((item) => item.prompt === prompt);
	if (!route) {
		throw new Error(`Unexpected campus-services guardrail prompt: ${prompt}`);
	}
	return route;
}

export function buildCampusServicesGuardrailExecutionResponse(
	input: CapabilityExecutionInput,
	currentCase: CampusServicesGuardrailCase,
): CapabilityExecutionResponse {
	const errorPayload =
		currentCase.expectedStatus === "rejected"
			? {
					code: "request_rejected",
					message: currentCase.responseAnswerText,
					retryable: false,
				}
			: currentCase.expectedStatus === "error"
				? {
						code: "internal_error",
						message: "supervisor failed",
						retryable: true,
					}
				: null;
	return {
		answerText: currentCase.responseAnswerText,
		error: errorPayload,
		followUpQuestion: currentCase.responseFollowUpQuestion,
		observability: {
			aclAnomalyCode: null,
			aclDecision: null,
			cachedInputTokens: null,
			candidateCount: 1,
			citationCount: null,
			citationExpected: null,
			citationMissing: null,
			estimatedCostMicrousd: null,
			failClosed: currentCase.expectedStatus === "no_answer",
			inputTokens: null,
			intentCapability: "campus_services",
			intentNextAction: "delegate",
			intentResolvedSlots: {
				allowed_tool: currentCase.expectedTool,
				payload_kind: currentCase.expectedTool,
			},
			intentRoutingConfidence: "high",
			intentScopeClass: "in_scope",
			intentTaskKind: "campus_services_lookup",
			modelName: null,
			modelProvider: null,
			outputTokens: null,
			refusalClass: null,
			retrievedSourceCount: null,
			retrievalAttempted: false,
			semanticOutcome:
				currentCase.expectedStatus === "no_answer"
					? "fail_closed"
					: currentCase.expectedStatus === "needs_clarification"
						? "needs_clarification"
						: currentCase.expectedStatus === "approval_required" ||
								currentCase.expectedStatus === "rejected"
							? "action_blocked"
							: "resolved_current",
		},
		result: {
			allowed_tools: [currentCase.expectedTool],
			payload_kind: currentCase.expectedTool,
			target: "campus_services",
			tool_result: currentCase.toolResult,
			diagnostics: {
				grounding_verdict:
					currentCase.expectedStatus === "completed" ? "supported" : "insufficient",
				retrieved_title_summary: [currentCase.expectedTool],
				semantic_outcome:
					currentCase.expectedStatus === "no_answer"
						? "fail_closed"
						: currentCase.expectedStatus === "needs_clarification"
							? "needs_clarification"
							: "resolved_current",
			},
		},
		selectedCapability: "campus_services",
		status: currentCase.expectedStatus,
		traceId: input.traceId,
	};
}
