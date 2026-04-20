import { eq, gte, inArray, lte } from "drizzle-orm";

import { qualityGradeProjection, requestObservabilityFact, traceBacklinkProjection } from "../../../db/schema";
import type {
  MetricRatio,
  NormalizedOperatorOverviewFilters,
  OperatorOverviewWindow,
  OperatorRequestObservabilityRecord as ObservabilityRecord,
  OperatorResultWindow,
  RequestProjectionRecord,
  OperatorAuditEventListItem,
} from "../service";
import type {
  QualityGradeProjectionRow,
  RequestObservabilityFactRow,
  RuntimeDatabase,
  TraceBacklinkProjectionRow,
} from "./runtime";

export function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function toRequestProjectionRecord(
  row: typeof import("../../../db/schema").requestProjection.$inferSelect,
): RequestProjectionRecord {
  return {
    answerPreview: row.answerPreview ?? null,
    completedAt: toIsoString(row.completedAt),
    conversationId: row.conversationId,
    ...(row.diagnosticsJson ? { diagnostics: row.diagnosticsJson } : {}),
    durationMs: row.durationMs ?? null,
    errorCode: row.errorCode ?? null,
    entitlementGroups: row.entitlementGroupsJson ?? [],
    entitlementSnapshotId: row.entitlementSnapshotId ?? null,
    principalId: row.principalId,
    principalLabel: row.principalLabel ?? null,
    principalType: row.principalType,
    projectedAt: row.projectedAt.toISOString(),
    questionPreview: row.questionPreview,
    requestId: row.requestId,
    requestedCapability: row.requestedCapability ?? null,
    requestedScope: row.requestedScopeJson ?? null,
    resolvedScope: row.resolvedScopeJson ?? null,
    selectedTarget: row.selectedTarget ?? null,
    sourceDocIds: row.sourceDocIdsJson ?? [],
    startedAt: row.startedAt.toISOString(),
    status: row.status as RequestProjectionRecord["status"],
    surface: row.surface,
    traceId: row.traceId,
    visibilityScope: row.visibilityScope ?? null,
    applicabilityScope: row.applicabilityScope ?? null,
  };
}

export function toAuditListItem(
  row: typeof import("../../../db/schema").requestAuditProjection.$inferSelect,
): OperatorAuditEventListItem {
  return {
    auditEventId: row.auditEventId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    principalType: row.principalType,
    requestId: row.requestId,
    selectedTarget: row.selectedTarget ?? null,
    status: row.status,
    summary: row.summary,
    surface: row.surface,
    traceId: row.traceId,
  };
}

export function resolveWindowBounds(window: OperatorOverviewWindow, now: Date) {
  const nowValue = now.valueOf();
  const durationMs =
    window === "15m"
      ? 15 * 60_000
      : window === "1h"
        ? 60 * 60_000
        : window === "24h"
          ? 24 * 60 * 60_000
          : window === "7d"
            ? 7 * 24 * 60 * 60_000
            : 30 * 24 * 60 * 60_000;
  const granularity =
    window === "15m"
      ? "5m"
      : window === "1h"
        ? "15m"
        : window === "24h"
          ? "1h"
          : "1d";

  return {
    from: new Date(nowValue - durationMs),
    granularity,
    to: now,
  } as const;
}

export function toRatio(count: number, eligibleCount: number | null): MetricRatio {
  return {
    count,
    eligibleCount,
    value: eligibleCount && eligibleCount > 0 ? Number((count / eligibleCount).toFixed(4)) : 0,
  };
}

export function resolveBucketStart(
  timestamp: string,
  granularity: OperatorResultWindow["granularity"],
): Date {
  const value = new Date(timestamp);
  if (granularity === "5m") {
    value.setUTCMinutes(Math.floor(value.getUTCMinutes() / 5) * 5, 0, 0);
    return value;
  }
  if (granularity === "15m") {
    value.setUTCMinutes(Math.floor(value.getUTCMinutes() / 15) * 15, 0, 0);
    return value;
  }
  if (granularity === "1h") {
    value.setUTCMinutes(0, 0, 0);
    return value;
  }
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

export function addGranularity(
  bucketStart: Date,
  granularity: OperatorResultWindow["granularity"],
): Date {
  const next = new Date(bucketStart);
  if (granularity === "5m") {
    next.setUTCMinutes(next.getUTCMinutes() + 5);
    return next;
  }
  if (granularity === "15m") {
    next.setUTCMinutes(next.getUTCMinutes() + 15);
    return next;
  }
  if (granularity === "1h") {
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function buildObservabilityConditions(
  filters: NormalizedOperatorOverviewFilters,
  bounds: ReturnType<typeof resolveWindowBounds>,
) {
  const conditions = [
    gte(requestObservabilityFact.startedAt, bounds.from),
    lte(requestObservabilityFact.startedAt, bounds.to),
  ];

  if (filters.surface) {
    conditions.push(eq(requestObservabilityFact.surface, filters.surface));
  }
  if (filters.selectedTarget) {
    conditions.push(eq(requestObservabilityFact.selectedTarget, filters.selectedTarget));
  }
  if (filters.requestedCapability) {
    conditions.push(eq(requestObservabilityFact.requestedCapability, filters.requestedCapability));
  }
  if (filters.principalType) {
    conditions.push(eq(requestObservabilityFact.principalType, filters.principalType));
  }
  if (filters.collection) {
    conditions.push(eq(requestObservabilityFact.collection, filters.collection));
  }
  if (filters.modelName) {
    conditions.push(eq(requestObservabilityFact.modelName, filters.modelName));
  }

  return conditions;
}

export function buildResultWindow(bounds: ReturnType<typeof resolveWindowBounds>) {
  return {
    from: bounds.from.toISOString(),
    granularity: bounds.granularity,
    to: bounds.to.toISOString(),
  } as const;
}

export function buildQualityGradeConditions(
  filters: NormalizedOperatorOverviewFilters,
  bounds: ReturnType<typeof resolveWindowBounds>,
  input: {
    gradeDomain?: string;
  } = {},
) {
  const conditions = [
    gte(qualityGradeProjection.requestStartedAt, bounds.from),
    lte(qualityGradeProjection.requestStartedAt, bounds.to),
  ];

  if (filters.surface) {
    conditions.push(eq(qualityGradeProjection.surface, filters.surface));
  }
  if (filters.selectedTarget) {
    conditions.push(eq(qualityGradeProjection.selectedTarget, filters.selectedTarget));
  }
  if (filters.requestedCapability) {
    conditions.push(eq(qualityGradeProjection.requestedCapability, filters.requestedCapability));
  }
  if (filters.principalType) {
    conditions.push(eq(qualityGradeProjection.principalType, filters.principalType));
  }
  if (filters.collection) {
    conditions.push(eq(qualityGradeProjection.collection, filters.collection));
  }
  if (filters.modelName) {
    conditions.push(eq(qualityGradeProjection.modelName, filters.modelName));
  }
  if (input.gradeDomain) {
    conditions.push(eq(qualityGradeProjection.gradeDomain, input.gradeDomain));
  }

  return conditions;
}

export function toLinks(
  row: TraceBacklinkProjectionRow | null | undefined,
): ObservabilityRecord["links"] {
  return {
    issueFingerprint: row?.issueFingerprint ?? null,
    issueLink: row?.issueLink ?? null,
    traceLink: row?.traceLink ?? null,
  };
}

export function toScore(scoreMilli: number | null): number | null {
  return typeof scoreMilli === "number" ? Number((scoreMilli / 1000).toFixed(3)) : null;
}

export function inferGradeDomainFromCauseClass(causeClass: string): string | null {
  if (causeClass.includes("citation")) {
    return "citation";
  }
  if (
    causeClass.includes("policy") ||
    causeClass.includes("acl") ||
    causeClass.includes("access") ||
    causeClass.includes("restricted") ||
    causeClass.includes("approval")
  ) {
    return "policy";
  }
  if (
    causeClass.includes("ground") ||
    causeClass.includes("recall") ||
    causeClass.includes("retrieval")
  ) {
    return "grounding";
  }

  return null;
}

export function buildGradeBucketMap(rows: QualityGradeProjectionRow[]) {
  const buckets = new Map<
    string,
    {
      latest: QualityGradeProjectionRow | null;
      byDomain: Map<string, QualityGradeProjectionRow>;
    }
  >();

  for (const row of rows) {
    const current = buckets.get(row.requestId) ?? {
      byDomain: new Map<string, QualityGradeProjectionRow>(),
      latest: null,
    };
    if (!current.latest) {
      current.latest = row;
    }
    if (!current.byDomain.has(row.gradeDomain)) {
      current.byDomain.set(row.gradeDomain, row);
    }
    buckets.set(row.requestId, current);
  }

  return buckets;
}

export async function loadTraceBacklinksByRequestIds(
  db: RuntimeDatabase,
  requestIds: string[],
): Promise<Map<string, TraceBacklinkProjectionRow>> {
  if (requestIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select()
    .from(traceBacklinkProjection)
    .where(inArray(traceBacklinkProjection.requestId, [...new Set(requestIds)]));

  return new Map(rows.map((row) => [row.requestId, row]));
}

export function resolveResultGranularity(
  filters: NormalizedOperatorOverviewFilters,
  bounds: ReturnType<typeof resolveWindowBounds>,
) {
  return filters.granularity ?? bounds.granularity;
}

export function sumNullableInteger(
  rows: RequestObservabilityFactRow[],
  selector: (row: RequestObservabilityFactRow) => number | null,
): number {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

export function aggregateCostByModel(rows: RequestObservabilityFactRow[]) {
  const grouped = new Map<
    string,
    { modelName: string; requestCount: number; estimatedCostMicrousd: number }
  >();

  for (const row of rows) {
    const modelName = row.modelName ?? "unknown";
    const current = grouped.get(modelName) ?? {
      estimatedCostMicrousd: 0,
      modelName,
      requestCount: 0,
    };
    current.requestCount += 1;
    current.estimatedCostMicrousd += row.estimatedCostMicrousd ?? 0;
    grouped.set(modelName, current);
  }

  return [...grouped.values()].sort(
    (left, right) =>
      right.estimatedCostMicrousd - left.estimatedCostMicrousd ||
      right.requestCount - left.requestCount ||
      left.modelName.localeCompare(right.modelName),
  );
}

export function aggregateCostBySurface(rows: RequestObservabilityFactRow[]) {
  const grouped = new Map<
    string,
    { surface: string; requestCount: number; estimatedCostMicrousd: number }
  >();

  for (const row of rows) {
    const current = grouped.get(row.surface) ?? {
      estimatedCostMicrousd: 0,
      requestCount: 0,
      surface: row.surface,
    };
    current.requestCount += 1;
    current.estimatedCostMicrousd += row.estimatedCostMicrousd ?? 0;
    grouped.set(row.surface, current);
  }

  return [...grouped.values()].sort(
    (left, right) =>
      right.estimatedCostMicrousd - left.estimatedCostMicrousd ||
      right.requestCount - left.requestCount ||
      left.surface.localeCompare(right.surface),
  );
}
