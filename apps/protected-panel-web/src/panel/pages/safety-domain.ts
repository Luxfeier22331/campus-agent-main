import { PANEL_COPY } from "../panel-copy";
import type { OperatorSafetySummaryRecord } from "../types";

function formatMetricRate(value: number) {
  return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
}

function formatMetricEvidence(metric: { count: number; eligibleCount: number | null }) {
  if (metric.eligibleCount === null) {
    return `${metric.count}`;
  }

  return `${metric.count} / ${metric.eligibleCount}`;
}

export function buildSafetyDecisionDistributionEntries(
  input: OperatorSafetySummaryRecord["summary"]["decisionDistribution"],
) {
  return [
    {
      count: input.allowed,
      key: "allowed",
      label: "允许",
    },
    {
      count: input.approvalRequired,
      key: "approvalRequired",
      label: PANEL_COPY.requestStatus.approval_required,
    },
    {
      count: input.denied,
      key: "denied",
      label: "拒绝",
    },
    {
      count: input.failClosed,
      key: "failClosed",
      label: "Fail Closed",
    },
  ] as const;
}

export function buildSafetyPostureEntries(summary: OperatorSafetySummaryRecord["summary"]) {
  return [
    {
      detail: formatMetricEvidence(summary.failClosedRate),
      key: "failClosed",
      label: "Fail Closed",
      tone: summary.failClosedRate.count > 0 ? "warning" : "success",
      value: formatMetricRate(summary.failClosedRate.value),
    },
    {
      detail: formatMetricEvidence(summary.restrictedDenyRate),
      key: "restrictedDeny",
      label: "Restricted Deny",
      tone: summary.restrictedDenyRate.count > 0 ? "info" : "success",
      value: formatMetricRate(summary.restrictedDenyRate.value),
    },
    {
      detail: formatMetricEvidence(summary.aclAnomalyRate),
      key: "aclAnomaly",
      label: "ACL 异常",
      tone: summary.aclAnomalyRate.count > 0 ? "warning" : "success",
      value: formatMetricRate(summary.aclAnomalyRate.value),
    },
  ] as const;
}

export function formatSafetyAnomalySeverity(value: string) {
  switch (value) {
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    default:
      return value;
  }
}

export function formatSafetyAnomalyStatus(value: string) {
  switch (value) {
    case "open":
      return "待处理";
    case "closed":
      return "已关闭";
    default:
      return value;
  }
}

export function formatSafetyAnomalyCode(value: string) {
  switch (value) {
    case "projection_missing":
      return "投影缺失";
    case "projection_conflict":
      return "投影冲突";
    case "fail_open_suspected":
      return "疑似 Fail Open";
    case "unauthorized_path":
      return "未授权路径";
    default:
      return value;
  }
}
