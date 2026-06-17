import { formatPanelTimestamp, PANEL_COPY } from "../panel-copy";
import type {
	RequestClaimSupportSummary,
	RequestIntentObservabilitySummary,
	RequestProjectionDiagnostics,
	RequestProjectionRecord,
	RequestReplaySummary,
	RequestRuntimeRunEventSummary,
	RequestRuntimeRunSummary,
} from "../types";

export { buildRequestStepTrajectoryEntries } from "./request-step-trajectory-formatters";

export const CURRENT_RUNTIME_TARGET_OPTIONS = [
	{ label: "检索专家", value: "knowledge" },
	{ label: "导航能力", value: "navigation" },
	{ label: "校园服务", value: "campus_services" },
	{ label: "通知能力", value: "notice" },
] as const;

export function formatDuration(durationMs: number | null) {
	if (durationMs === null || !Number.isFinite(durationMs)) {
		return PANEL_COPY.pending;
	}

	if (durationMs < 1000) {
		return `${durationMs} ms`;
	}

	return `${(durationMs / 1000).toFixed(2)} s`;
}

export function formatScope(scope: Record<string, unknown> | null) {
	if (!scope) {
		return PANEL_COPY.unspecified;
	}

	const parts = Object.entries(scope)
		.filter(([, value]) => typeof value === "string" && value.length > 0)
		.map(([key, value]) => `${key}:${value}`);

	return parts.length > 0 ? parts.join(" · ") : PANEL_COPY.unspecified;
}

export function formatStatusLabel(status: string) {
	switch (status) {
		case "accepted":
			return PANEL_COPY.requestStatus.accepted;
		case "completed":
			return PANEL_COPY.requestStatus.completed;
		case "needs_clarification":
			return PANEL_COPY.requestStatus.needs_clarification;
		case "approval_required":
			return PANEL_COPY.requestStatus.approval_required;
		case "rejected":
			return PANEL_COPY.requestStatus.rejected;
		case "no_answer":
			return PANEL_COPY.requestStatus.no_answer;
		case "error":
			return PANEL_COPY.requestStatus.error;
		default:
			return status;
	}
}

export function formatSurfaceLabel(surface: string) {
	if (surface === "public_chat_web") {
		return "公开聊天网页";
	}
	if (surface === "operator_console_web") {
		return "受保护运维面板";
	}

	return surface
		.split("_")
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

export function formatPrincipalTypeLabel(principalType: string) {
	switch (principalType) {
		case "operator":
			return "运维人员";
		case "public_user":
			return "公开用户";
		case "campus_member":
			return "校园成员";
		case "student":
			return "学生";
		default:
			return principalType;
	}
}

export function formatCapabilityLabel(capability: string | null) {
	if (!capability) {
		return PANEL_COPY.unspecified;
	}

	switch (capability) {
		case "knowledge":
			return "知识问答";
		case "place_lookup":
			return "地点查询";
		case "campus_services":
			return "校园服务";
		case "notice":
			return "通知公告";
		default:
			return capability;
	}
}

export function formatSelectedCapabilityLabel(target: string | null) {
	if (!target) {
		return PANEL_COPY.notSelected;
	}

	switch (target) {
		case "knowledge":
			return "检索专家";
		case "navigation":
			return "导航能力";
		case "campus_services":
			return "校园服务";
		case "notice":
			return "通知能力";
		default:
			return target;
	}
}

export function formatIntentTaskKindLabel(taskKind: string | null) {
	if (!taskKind) {
		return PANEL_COPY.unspecified;
	}

	switch (taskKind) {
		case "knowledge_lookup":
			return "知识检索";
		case "place_lookup":
			return "地点查询";
		case "campus_services_lookup":
			return "服务查询";
		case "notice_lookup":
			return "通知查询";
		case "unknown":
			return PANEL_COPY.unknown;
		default:
			return taskKind;
	}
}

export function formatIntentLaunchStateLabel(launchState: string | null) {
	if (!launchState) {
		return PANEL_COPY.unknown;
	}

	switch (launchState) {
		case "open":
			return "已开放";
		case "candidate_only":
			return "候选观察";
		case "closed":
			return "已关闭";
		default:
			return launchState;
	}
}

export function formatIntentNextActionLabel(nextAction: string | null) {
	if (!nextAction) {
		return PANEL_COPY.unknown;
	}

	switch (nextAction) {
		case "delegate":
			return "委派执行";
		case "clarify":
			return "请求澄清";
		case "approval_required":
			return "需要审批";
		case "out_of_scope":
			return "范围外";
		case "rejected":
			return "拒绝";
		default:
			return nextAction;
	}
}

export function formatIntentScopeClassLabel(scopeClass: string | null) {
	if (!scopeClass) {
		return PANEL_COPY.unknown;
	}

	switch (scopeClass) {
		case "in_scope":
			return "范围内";
		case "out_of_scope":
			return "范围外";
		default:
			return scopeClass;
	}
}

export function formatIntentReasonLabel(reason: string | null) {
	if (!reason) {
		return PANEL_COPY.none;
	}

	switch (reason) {
		case "campus_context_signal":
			return "校园上下文信号";
		case "campus_scope_signal":
			return "校园范围信号";
		case "explicit_requested_capability":
			return "显式请求能力";
		case "explicit_requested_scope":
			return "显式请求范围";
		case "navigation_temporarily_unsupported":
			return "导航能力暂未开放";
		case "policy_guardrail":
			return "策略保护";
		case "political_persuasion":
			return "政治说服请求";
		case "product_scope_boundary":
			return "产品范围边界";
		case "scope_undetermined_delegate":
			return "范围未明确，委派处理";
		case "structured_runtime_candidate_signal":
			return "结构化能力候选信号";
		case "transaction_guardrail":
			return "事务操作保护";
		default:
			return reason;
	}
}

function formatIntentContextResolutionStateLabel(state: string | null) {
	if (!state) {
		return PANEL_COPY.unknown;
	}
	switch (state) {
		case "not_follow_up":
			return "非追问";
		case "resolved":
			return "已解析";
		case "ambiguous":
			return "有歧义";
		case "missing_context":
			return "缺少上下文";
		default:
			return state;
	}
}

function formatIntentContextReferenceTypeLabel(referenceType: string | null) {
	if (!referenceType) {
		return PANEL_COPY.unknown;
	}
	switch (referenceType) {
		case "none":
			return "无";
		case "selected_notice":
			return "已选通知";
		case "curriculum_slot":
			return "培养方案槽位";
		case "previous_goal":
			return "上一轮目标";
		case "service_temporal_reference":
			return "服务时间引用";
		default:
			return referenceType;
	}
}

function formatIntentRoutingConfidenceLabel(confidence: string | null) {
	if (!confidence) {
		return PANEL_COPY.unknown;
	}
	switch (confidence) {
		case "high":
			return "高";
		case "medium":
			return "中";
		case "low":
			return "低";
		default:
			return confidence;
	}
}

function formatStringList(items: string[] | null | undefined) {
	if (!items || items.length === 0) {
		return "无";
	}
	return items.join(", ");
}

function formatResolvedSlots(slots: Record<string, string> | null | undefined) {
	if (!slots || Object.keys(slots).length === 0) {
		return "无";
	}
	return Object.entries(slots)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

export function buildRequestIntentEntries(intent: RequestIntentObservabilitySummary | undefined) {
	if (!intent) {
		return [];
	}

	return [
		{
			label: "识别能力",
			value: formatCapabilityLabel(intent.capability),
		},
		{
			label: "任务类型",
			value: formatIntentTaskKindLabel(intent.taskKind),
		},
		{
			label: "开放状态",
			value: formatIntentLaunchStateLabel(intent.launchState),
		},
		{
			label: "下一步动作",
			value: formatIntentNextActionLabel(intent.nextAction),
		},
		{
			label: "范围判定",
			value: formatIntentScopeClassLabel(intent.scopeClass),
		},
		{
			label: "范围原因",
			value: formatIntentReasonLabel(intent.scopeReason),
		},
		{
			label: "策略原因",
			value: formatIntentReasonLabel(intent.policyReason),
		},
		{
			label: "上下文解析",
			value: formatIntentContextResolutionStateLabel(intent.contextResolutionState ?? null),
		},
		{
			label: "上下文引用",
			value: formatIntentContextReferenceTypeLabel(intent.contextReferenceType ?? null),
		},
		{
			label: "路由置信度",
			value: formatIntentRoutingConfidenceLabel(intent.routingConfidence ?? null),
		},
		{
			label: "缺失槽位",
			value: formatStringList(intent.missingSlots),
		},
		{
			label: "解析槽位",
			value: formatResolvedSlots(intent.resolvedSlots),
		},
		{
			label: "意图 Schema",
			value: intent.schemaVersion || PANEL_COPY.unknown,
		},
		{
			label: "分类器版本",
			value: intent.classifierVersion || PANEL_COPY.unknown,
		},
	];
}

export { buildRequestWorkflowTraceEntries } from "./request-workflow-formatters";

function formatRuntimeRunEventSummary(event: RequestRuntimeRunEventSummary | null) {
	if (!event) {
		return PANEL_COPY.notAvailable;
	}

	return `${event.sequence} · ${event.eventType} · ${event.visibility} · ${formatTimestamp(
		event.occurredAt,
	)}`;
}

export type RequestStepTrajectoryEntry =
	| {
			kind: "summary";
			metrics: string;
	  }
	| {
			attempts: string;
			capability: string;
			diagnosticGroups: Array<{
				items: string[];
				kind: "agent" | "provider" | "replan" | "runtime" | "terminal";
			}>;
			diagnostics: string[];
			duration: string;
			kind: "step";
			latestResultRef: string;
			model: string;
			providerRequestRef: string;
			status: string;
			stepId: string;
			stepKind: string;
			taskQueue: string;
			tokenCost: string;
			workerId: string;
	  };

export function buildRequestRuntimeRunEntries(run: RequestRuntimeRunSummary | null | undefined) {
	if (!run) {
		return [];
	}

	return [
		{
			label: "Run ID",
			value: run.run.runId,
		},
		{
			label: "Run 状态",
			value: run.run.status,
		},
		{
			label: "Run 阶段",
			value: run.run.phase || PANEL_COPY.unknown,
		},
		{
			label: "终态原因",
			value: run.run.terminalReason || PANEL_COPY.none,
		},
		{
			label: "事件数",
			value: String(run.eventSummary.eventCount),
		},
		{
			label: "最近事件",
			value: formatRuntimeRunEventSummary(run.eventSummary.latestEvent),
		},
		{
			label: "终态事件",
			value: formatRuntimeRunEventSummary(run.eventSummary.terminalEvent),
		},
		{
			label: "可见性分布",
			value: [
				`internal=${run.eventSummary.visibilityCounts.internal}`,
				`panel=${run.eventSummary.visibilityCounts.panel}`,
				`browser=${run.eventSummary.visibilityCounts.browser}`,
				`eval=${run.eventSummary.visibilityCounts.eval}`,
			].join(" · "),
		},
	];
}

function formatClaimSupportSummary(summary: RequestClaimSupportSummary | null | undefined) {
	if (!summary) {
		return PANEL_COPY.unknown;
	}

	return `${summary.supportedClaims}/${summary.totalClaims} 支撑 · ${summary.unsupportedClaims} 未支撑`;
}

function formatGroundingDowngradeState(value: boolean | null) {
	if (value === null) {
		return PANEL_COPY.unknown;
	}

	return value ? "证据受限" : "证据完整";
}

function formatPromptSummary(prompt: RequestReplaySummary["prompt"]) {
	if (!prompt) {
		return PANEL_COPY.unknown;
	}

	const identity = prompt.id || PANEL_COPY.unknown;
	const version = prompt.version ? `@${prompt.version}` : "";
	const runtime = prompt.runtimeState || prompt.runtimeDetail || PANEL_COPY.unknown;
	return `${identity}${version} · ${runtime}`;
}

function formatRetrievalPlanSummary(plan: NonNullable<RequestReplaySummary["retrieval"]>["plan"]) {
	if (!plan) {
		return PANEL_COPY.unknown;
	}

	return [
		plan.planId || PANEL_COPY.unknown,
		plan.queryMode || PANEL_COPY.unknown,
		plan.terminalState || PANEL_COPY.unknown,
	].join(" · ");
}

export function buildRequestReplayEntries(replay: RequestReplaySummary | undefined) {
	if (!replay) {
		return [];
	}

	const retrieval = replay.retrieval;
	const answerQuality = replay.answerQuality;
	const prompt = replay.prompt;
	const execution = replay.execution;
	const entries: Array<{ label: string; value: string }> = [];

	if (retrieval) {
		entries.push(
			{
				label: "检索充分性",
				value: retrieval.adequacyVerdict || PANEL_COPY.unknown,
			},
			{
				label: "检索原因",
				value: retrieval.adequacyReason || PANEL_COPY.unknown,
			},
			{
				label: "检索计划",
				value: formatRetrievalPlanSummary(retrieval.plan),
			},
			{
				label: "来源轨迹",
				value: `召回 ${retrieval.sourceTraceCounts.retrieved} · 支撑 ${retrieval.sourceTraceCounts.supporting}`,
			},
		);
	}

	if (answerQuality) {
		entries.push(
			{
				label: "声明支撑",
				value: formatClaimSupportSummary(answerQuality.claimSupportSummary),
			},
			{
				label: "Grounding",
				value: `${answerQuality.groundingVerdict || PANEL_COPY.unknown} · ${formatGroundingDowngradeState(
					answerQuality.groundingDowngraded,
				)}`,
			},
		);
	}

	if (prompt) {
		entries.push({
			label: "Prompt",
			value: formatPromptSummary(prompt),
		});
	}

	if (execution?.semanticOutcome) {
		entries.push({
			label: "执行语义",
			value: execution.semanticOutcome,
		});
	}

	return entries;
}

export function formatAclDecisionLabel(decision: string | null) {
	if (!decision) {
		return PANEL_COPY.unknown;
	}

	switch (decision) {
		case "allowed":
			return "允许";
		case "denied":
			return "拒绝";
		default:
			return decision;
	}
}

export function formatTimestamp(value: string | null) {
	return formatPanelTimestamp(value);
}

function formatCodeLabel(value: string) {
	return value;
}

export function formatRequestDiagnosticReason(reason: string | null | undefined) {
	if (!reason) {
		return PANEL_COPY.unspecified;
	}

	switch (reason) {
		case "policy_object_missing":
			return "未找到政策对象";
		case "policy_object_conflict":
			return "政策对象冲突";
		case "resolved_policy_clause_not_found":
			return "未找到命中的政策条款";
		default:
			return formatCodeLabel(reason);
	}
}

export function buildRequestDiagnosticEntries(
	diagnostics: RequestProjectionDiagnostics | undefined,
) {
	if (!diagnostics) {
		return [];
	}

	const entries: Array<{ label: string; value: string }> = [];
	const resolvedPolicy =
		diagnostics.resolvedPolicyTitle && diagnostics.resolvedPolicyDocumentId
			? `${diagnostics.resolvedPolicyTitle} (${diagnostics.resolvedPolicyDocumentId})`
			: diagnostics.resolvedPolicyTitle || diagnostics.resolvedPolicyDocumentId;

	if (resolvedPolicy) {
		entries.push({
			label: "命中政策",
			value: resolvedPolicy,
		});
	}
	if (diagnostics.rewrittenQuery) {
		entries.push({
			label: "重写后的问题",
			value: diagnostics.rewrittenQuery,
		});
	}
	if (diagnostics.clarificationReason) {
		entries.push({
			label: "澄清原因",
			value: formatRequestDiagnosticReason(diagnostics.clarificationReason),
		});
	}
	if (diagnostics.noAnswerReason) {
		entries.push({
			label: "无法回答原因",
			value: formatRequestDiagnosticReason(diagnostics.noAnswerReason),
		});
	}
	if (diagnostics.retrievedTitleSummary.length > 0) {
		entries.push({
			label: "召回标题",
			value: diagnostics.retrievedTitleSummary.join(" · "),
		});
	}

	return entries;
}

export interface RequestOutcomeBadge {
	color: "default" | "error" | "info" | "success" | "warning";
	label: string;
}

type RequestOutcomeInput = Pick<
	RequestProjectionRecord,
	"answerPreview" | "diagnostics" | "errorCode" | "sourceDocIds" | "status"
>;

export function buildRequestOutcomeBadges(record: RequestOutcomeInput): RequestOutcomeBadge[] {
	const badges: RequestOutcomeBadge[] = [];

	if (record.errorCode) {
		badges.push({
			color: "error",
			label: `错误码 ${record.errorCode}`,
		});
	}

	if (record.sourceDocIds.length === 0) {
		badges.push({
			color: "default",
			label: PANEL_COPY.requestsList.outcome.noSourceDocuments,
		});
	} else {
		badges.push({
			color: "default",
			label: `命中 ${record.sourceDocIds.length} 个来源`,
		});
	}

	if (record.status === "completed" && record.answerPreview) {
		badges.push({
			color: "success",
			label: PANEL_COPY.requestsList.outcome.answerReady,
		});
	}

	return badges;
}

export function formatRequestOutcomeDetail(record: RequestOutcomeInput): string {
	if (record.status === "needs_clarification") {
		return record.diagnostics?.clarificationReason
			? formatRequestDiagnosticReason(record.diagnostics.clarificationReason)
			: PANEL_COPY.requestStatus.needs_clarification;
	}

	if (record.status === "approval_required") {
		return PANEL_COPY.requestStatus.approval_required;
	}

	if (record.status === "rejected") {
		return PANEL_COPY.requestsList.outcome.rejected;
	}

	if (record.status === "no_answer") {
		return record.diagnostics?.noAnswerReason
			? formatRequestDiagnosticReason(record.diagnostics.noAnswerReason)
			: PANEL_COPY.requestStatus.no_answer;
	}

	if (record.answerPreview?.trim()) {
		return record.answerPreview.trim();
	}

	if (record.status === "completed") {
		return PANEL_COPY.requestsList.outcome.completedWithoutPreview;
	}

	if (record.status === "accepted") {
		return PANEL_COPY.requestsList.outcome.accepted;
	}

	return PANEL_COPY.requestsList.outcome.noDetail;
}
