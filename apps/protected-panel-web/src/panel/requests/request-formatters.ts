import type { RequestProjectionDiagnostics } from "../types";
import { PANEL_COPY, formatPanelTimestamp } from "../panel-copy";

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
    default:
      return capability;
  }
}

export function formatSelectedTargetLabel(target: string | null) {
  if (!target) {
    return PANEL_COPY.notSelected;
  }

  switch (target) {
    case "rag-specialist":
      return "检索专家";
    default:
      return target;
  }
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
