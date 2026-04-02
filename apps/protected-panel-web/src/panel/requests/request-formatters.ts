import type { RequestProjectionDiagnostics } from "../types";

export function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "Pending";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function formatScope(scope: Record<string, unknown> | null) {
  if (!scope) {
    return "Unspecified";
  }

  const parts = Object.entries(scope)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${key}:${value}`);

  return parts.length > 0 ? parts.join(" · ") : "Unspecified";
}

export function formatStatusLabel(status: string) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "completed":
      return "Completed";
    case "needs_clarification":
      return "Needs clarification";
    case "approval_required":
      return "Approval required";
    case "rejected":
      return "Rejected";
    case "no_answer":
      return "No answer";
    case "error":
      return "Error";
    default:
      return status;
  }
}

export function formatSurfaceLabel(surface: string) {
  if (surface === "public_chat_web") {
    return "Public chat web";
  }
  if (surface === "protected_panel_web") {
    return "Protected panel web";
  }

  return surface
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCodeLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatRequestDiagnosticReason(reason: string | null | undefined) {
  if (!reason) {
    return "Unspecified";
  }

  switch (reason) {
    case "policy_object_missing":
      return "Policy object missing";
    case "policy_object_conflict":
      return "Policy object conflict";
    case "resolved_policy_clause_not_found":
      return "Resolved policy clause not found";
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
      label: "Resolved Policy",
      value: resolvedPolicy,
    });
  }
  if (diagnostics.rewrittenQuery) {
    entries.push({
      label: "Rewritten Query",
      value: diagnostics.rewrittenQuery,
    });
  }
  if (diagnostics.clarificationReason) {
    entries.push({
      label: "Clarification Reason",
      value: formatRequestDiagnosticReason(diagnostics.clarificationReason),
    });
  }
  if (diagnostics.noAnswerReason) {
    entries.push({
      label: "No-answer Reason",
      value: formatRequestDiagnosticReason(diagnostics.noAnswerReason),
    });
  }
  if (diagnostics.retrievedTitleSummary.length > 0) {
    entries.push({
      label: "Retrieved Titles",
      value: diagnostics.retrievedTitleSummary.join(" · "),
    });
  }

  return entries;
}
