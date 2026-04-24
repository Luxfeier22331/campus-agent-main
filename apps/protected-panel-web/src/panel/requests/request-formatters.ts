import { formatPanelTimestamp, PANEL_COPY } from "../panel-copy";
import type {
	RequestIntentObservabilitySummary,
	RequestProjectionDiagnostics,
	RequestProjectionRecord,
} from "../types";

export const CURRENT_RUNTIME_TARGET_OPTIONS = [
	{ label: "检索专家", value: "rag-agent" },
	{ label: "导航能力", value: "navigation-agent" },
	{ label: "校园服务", value: "campus-services-agent" },
	{ label: "通知能力", value: "notice-agent" },
] as const;

export function formatDuration(durationMs: number | null) {
	if (durationMs === null) {
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
	if (surface === "protected_panel_web") {
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

export function formatSelectedTargetLabel(target: string | null) {
	if (!target) {
		return PANEL_COPY.notSelected;
	}

	switch (target) {
		case "rag-agent":
			return "检索专家";
		case "navigation-agent":
			return "导航能力";
		case "campus-services-agent":
			return "校园服务";
		case "notice-agent":
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
			label: "分类器版本",
			value: intent.classifierVersion || PANEL_COPY.unknown,
		},
	];
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
