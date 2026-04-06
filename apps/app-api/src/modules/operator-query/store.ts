import { and, desc, eq, gte, ilike, inArray, lt, lte, or } from "drizzle-orm";

import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../base64url";
import type { Env } from "../../config";
import { createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
  metricRollup,
  qualityBadcaseProjection,
  qualityGradeProjection,
  requestAuditProjection,
  requestObservabilityFact,
  requestProjection,
  traceBacklinkProjection,
} from "../../db/schema";
import type {
  MetricRatio,
  NormalizedOperatorAuditListFilters,
  OperatorCostSummaryResult,
  OperatorAuditEventDetail,
  OperatorAuditEventListItem,
  OperatorAuditListResult,
  NormalizedOperatorOverviewFilters,
  NormalizedOperatorQualityBadcaseListFilters,
  NormalizedOperatorRequestListFilters,
  OperatorOverviewResult,
  OperatorOverviewWindow,
  OperatorQualityBadcaseListResult,
  OperatorQualitySummaryResult,
  OperatorQualityTimeseriesResult,
  OperatorQueryListResult,
  OperatorQueryStore,
  OperatorRequestObservabilityRecord,
  OperatorSafetySummaryResult,
  RequestProjectionRecord,
} from "./service";

interface RequestProjectionCursor {
  requestId: string;
  startedAt: string;
}

interface AuditProjectionCursor {
  auditEventId: string;
  occurredAt: string;
}

type RequestObservabilityFactRow = typeof requestObservabilityFact.$inferSelect;
type MetricRollupRow = typeof metricRollup.$inferSelect;
type QualityGradeProjectionRow = typeof qualityGradeProjection.$inferSelect;
type TraceBacklinkProjectionRow = typeof traceBacklinkProjection.$inferSelect;
type RuntimeDatabase = Awaited<ReturnType<typeof createRuntimeDatabase>>;
type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function toRequestProjectionRecord(
  row: typeof requestProjection.$inferSelect,
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

function toAuditListItem(
  row: typeof requestAuditProjection.$inferSelect,
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

function encodeCursor(input: RequestProjectionCursor): string {
  return encodeBase64UrlJson(input);
}

function encodeAuditCursor(input: AuditProjectionCursor): string {
  return encodeBase64UrlJson(input);
}

function decodeCursor(cursor: string): RequestProjectionCursor | null {
  try {
    const parsed = decodeBase64UrlJson<Partial<RequestProjectionCursor>>(cursor);

    if (
      typeof parsed.requestId !== "string" ||
      !parsed.requestId ||
      typeof parsed.startedAt !== "string" ||
      !parsed.startedAt
    ) {
      return null;
    }

    return {
      requestId: parsed.requestId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function decodeAuditCursor(cursor: string): AuditProjectionCursor | null {
  try {
    const parsed = decodeBase64UrlJson<Partial<AuditProjectionCursor>>(cursor);

    if (
      typeof parsed.auditEventId !== "string" ||
      !parsed.auditEventId ||
      typeof parsed.occurredAt !== "string" ||
      !parsed.occurredAt
    ) {
      return null;
    }

    return {
      auditEventId: parsed.auditEventId,
      occurredAt: parsed.occurredAt,
    };
  } catch {
    return null;
  }
}

function resolveWindowBounds(window: OperatorOverviewWindow, now: Date) {
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

function toRatio(count: number, eligibleCount: number | null): MetricRatio {
  return {
    count,
    eligibleCount,
    value: eligibleCount && eligibleCount > 0 ? Number((count / eligibleCount).toFixed(4)) : 0,
  };
}

function percentile(values: number[], percentileValue: number): number | null {
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

function buildObservabilityConditions(
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

function buildResultWindow(bounds: ReturnType<typeof resolveWindowBounds>) {
  return {
    from: bounds.from.toISOString(),
    granularity: bounds.granularity,
    to: bounds.to.toISOString(),
  } as const;
}

function buildQualityGradeConditions(
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

function toLinks(
  row: TraceBacklinkProjectionRow | null | undefined,
): OperatorRequestObservabilityRecord["links"] {
  return {
    issueFingerprint: row?.issueFingerprint ?? null,
    issueLink: row?.issueLink ?? null,
    traceLink: row?.traceLink ?? null,
  };
}

function toScore(scoreMilli: number | null): number | null {
  return typeof scoreMilli === "number"
    ? Number((scoreMilli / 1000).toFixed(3))
    : null;
}

function inferGradeDomainFromCauseClass(causeClass: string): string | null {
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

function buildGradeBucketMap(rows: QualityGradeProjectionRow[]) {
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

async function loadTraceBacklinksByRequestIds(
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

function resolveResultGranularity(
  filters: NormalizedOperatorOverviewFilters,
  bounds: ReturnType<typeof resolveWindowBounds>,
) {
  return filters.granularity ?? bounds.granularity;
}

function sumNullableInteger(
  rows: RequestObservabilityFactRow[],
  selector: (row: RequestObservabilityFactRow) => number | null,
): number {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

function aggregateCostByModel(rows: RequestObservabilityFactRow[]) {
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

function aggregateCostBySurface(rows: RequestObservabilityFactRow[]) {
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

export function createPgOperatorQueryStore(
  env: Env,
  input: {
    getDb?: RuntimeDbGetter;
    now?: () => Date;
  } = {},
): OperatorQueryStore {
  const getDb = input.getDb ?? createRuntimeDbGetter(env);
  const now = input.now ?? (() => new Date());

  async function loadObservabilityRows(filters: NormalizedOperatorOverviewFilters) {
    const db = await getDb();
    const bounds = resolveWindowBounds(filters.window, now());
    const rows = await db
      .select()
      .from(requestObservabilityFact)
      .where(and(...buildObservabilityConditions(filters, bounds)));

    return { bounds, rows };
  }

  async function loadQualityGradeRows(
    filters: NormalizedOperatorOverviewFilters,
    input: {
      gradeDomain?: string;
    } = {},
  ) {
    const db = await getDb();
    const bounds = resolveWindowBounds(filters.window, now());
    const rows = await db
      .select()
      .from(qualityGradeProjection)
      .where(and(...buildQualityGradeConditions(filters, bounds, input)))
      .orderBy(
        desc(qualityGradeProjection.requestStartedAt),
        desc(qualityGradeProjection.sampledAt),
        desc(qualityGradeProjection.gradeId),
      );

    return { bounds, rows };
  }

  async function loadQualityRollupRows(filters: NormalizedOperatorOverviewFilters) {
    const db = await getDb();
    const bounds = resolveWindowBounds(filters.window, now());
    const granularity = resolveResultGranularity(filters, bounds);
    const conditions = [
      eq(metricRollup.domain, "quality"),
      eq(metricRollup.granularity, granularity),
      gte(metricRollup.bucketStart, bounds.from),
      lt(metricRollup.bucketStart, bounds.to),
    ];

    if (filters.surface) {
      conditions.push(eq(metricRollup.surface, filters.surface));
    }
    if (filters.selectedTarget) {
      conditions.push(eq(metricRollup.selectedTarget, filters.selectedTarget));
    }
    if (filters.requestedCapability) {
      conditions.push(eq(metricRollup.requestedCapability, filters.requestedCapability));
    }
    if (filters.principalType) {
      conditions.push(eq(metricRollup.principalType, filters.principalType));
    }
    if (filters.collection) {
      conditions.push(eq(metricRollup.collection, filters.collection));
    }
    if (filters.modelName) {
      conditions.push(eq(metricRollup.modelName, filters.modelName));
    }

    const rows = await db
      .select()
      .from(metricRollup)
      .where(and(...conditions))
      .orderBy(metricRollup.bucketStart);

    return { bounds, granularity, rows };
  }

  return {
    async getById(requestId) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(requestProjection)
        .where(eq(requestProjection.requestId, requestId))
        .limit(1);

      return rows[0] ? toRequestProjectionRecord(rows[0]) : null;
    },

    async getAuditById(auditEventId) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(requestAuditProjection)
        .where(eq(requestAuditProjection.auditEventId, auditEventId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }

      const backlinkRows = await db
        .select()
        .from(traceBacklinkProjection)
        .where(eq(traceBacklinkProjection.requestId, row.requestId))
        .limit(1);
      const backlink = backlinkRows[0] ?? null;

      return {
        event: {
          auditEventId: row.auditEventId,
          diagnostics: row.diagnosticsJson,
          entitlementSnapshotId: row.entitlementSnapshotId ?? null,
          eventType: row.eventType,
          occurredAt: row.occurredAt.toISOString(),
          policyProjectionVersion: row.policyProjectionVersion ?? null,
          principalType: row.principalType,
          requestId: row.requestId,
          requestedCapability: row.requestedCapability ?? null,
          selectedTarget: row.selectedTarget ?? null,
          status: row.status,
          summary: row.summary,
          surface: row.surface,
          terminalCode: row.terminalCode ?? null,
          traceId: row.traceId,
        },
        links: toLinks(backlink),
      } satisfies OperatorAuditEventDetail;
    },

    async getObservabilityById(requestId) {
      const db = await getDb();
      const projectionRows = await db
        .select()
        .from(requestProjection)
        .where(eq(requestProjection.requestId, requestId))
        .limit(1);
      const projection = projectionRows[0];
      if (!projection) {
        return null;
      }

      const factRows = await db
        .select()
        .from(requestObservabilityFact)
        .where(eq(requestObservabilityFact.requestId, requestId))
        .limit(1);
      const fact = factRows[0] ?? null;
      const auditRows = await db
        .select()
        .from(requestAuditProjection)
        .where(eq(requestAuditProjection.requestId, requestId))
        .orderBy(desc(requestAuditProjection.occurredAt), desc(requestAuditProjection.auditEventId));
      const backlinkRows = await db
        .select()
        .from(traceBacklinkProjection)
        .where(eq(traceBacklinkProjection.requestId, requestId))
        .limit(1);
      const backlink = backlinkRows[0] ?? null;
      const sourceDocIds = projection.sourceDocIdsJson ?? [];

      return {
        auditSummary: {
          auditEventCount: auditRows.length,
          latestTerminalCode:
            auditRows.find((row) => row.terminalCode)?.terminalCode ?? projection.status,
        },
        links: toLinks(backlink),
        observability: {
          aclAnomalyCode: fact?.aclAnomalyCode ?? null,
          aclDecision: fact?.aclDecision ?? null,
          cachedInputTokens: fact?.cachedInputTokens ?? null,
          candidateCount: fact?.candidateCount ?? null,
          citationCount: fact?.citationCount ?? sourceDocIds.length,
          citationExpected: fact?.citationExpected ?? null,
          citationMissing: fact?.citationMissing ?? null,
          durationMs: fact?.durationMs ?? projection.durationMs ?? null,
          emptyRecall: fact?.emptyRecall ?? null,
          estimatedCost: {
            currency: "USD",
            microusd: fact?.estimatedCostMicrousd ?? null,
          },
          failClosed: fact?.failClosed ?? null,
          inputTokens: fact?.inputTokens ?? null,
          measuredAt: fact ? fact.measuredAt.toISOString() : projection.projectedAt.toISOString(),
          model: {
            name: fact?.modelName ?? null,
            provider: fact?.modelProvider ?? null,
          },
          outputTokens: fact?.outputTokens ?? null,
          projectionLagMs: fact?.projectionLagMs ?? null,
          refusalClass: fact?.refusalClass ?? null,
          retrievedSourceCount: fact?.retrievedSourceCount ?? sourceDocIds.length,
          retrievalAttempted: fact?.retrievalAttempted ?? null,
          traceAvailable: fact?.traceAvailable ?? Boolean(projection.traceId),
        },
        request: {
          completedAt: toIsoString(projection.completedAt),
          conversationId: projection.conversationId,
          requestId: projection.requestId,
          requestedCapability: projection.requestedCapability ?? null,
          requestedScope: projection.requestedScopeJson ?? null,
          resolvedScope: projection.resolvedScopeJson ?? null,
          selectedTarget: projection.selectedTarget ?? null,
          startedAt: projection.startedAt.toISOString(),
          status: projection.status as OperatorRequestObservabilityRecord["request"]["status"],
          surface: projection.surface,
          traceId: projection.traceId,
        },
      };
    },

    async getOverview(filters: NormalizedOperatorOverviewFilters) {
      const { bounds, rows } = await loadObservabilityRows(filters);

      const total = rows.length;
      const durations = rows
        .map((row) => row.durationMs)
        .filter((value): value is number => typeof value === "number");
      const retrievalEligible = rows.filter((row) => row.retrievalAttempted === true);
      const citationEligible = rows.filter((row) => row.citationExpected === true);
      const refusalCount = rows.filter((row) =>
        row.status === "needs_clarification" ||
        row.status === "no_answer" ||
        row.status === "approval_required" ||
        row.status === "rejected"
      ).length;
      const estimatedCostMicrousd = rows.reduce(
        (sum, row) => sum + (row.estimatedCostMicrousd ?? 0),
        0,
      );

      return {
        alerts: [],
        asOf: bounds.to.toISOString(),
        overview: {
          aclAnomalyRate: toRatio(
            rows.filter((row) => Boolean(row.aclAnomalyCode)).length,
            total,
          ),
          citationMissRate: toRatio(
            citationEligible.filter((row) => row.citationMissing === true).length,
            citationEligible.length,
          ),
          emptyRecallRate: toRatio(
            retrievalEligible.filter((row) => row.emptyRecall === true).length,
            retrievalEligible.length,
          ),
          estimatedCost: {
            currency: "USD",
            microusd: estimatedCostMicrousd,
          },
          failureRate: toRatio(
            rows.filter((row) => row.status === "error").length,
            total,
          ),
          latency: {
            p50Ms: percentile(durations, 50),
            p95Ms: percentile(durations, 95),
            p99Ms: percentile(durations, 99),
          },
          refusalRate: toRatio(refusalCount, total),
          requestVolume: {
            accepted: total,
            completed: rows.filter((row) => row.status === "completed").length,
            errored: rows.filter((row) => row.status === "error").length,
          },
          sinkHealth: {
            missingTraceRate: toRatio(
              rows.filter((row) => row.traceAvailable === false).length,
              total,
            ),
            projectionFailureCount: 0,
          },
        },
        window: buildResultWindow(bounds),
      } satisfies OperatorOverviewResult;
    },

    async getQualitySummary(filters: NormalizedOperatorOverviewFilters) {
      const { bounds, rows } = await loadObservabilityRows(filters);
      const retrievalEligible = rows.filter((row) => row.retrievalAttempted === true);
      const citationEligible = rows.filter((row) => row.citationExpected === true);
      const { rows: gradeRows } = await loadQualityGradeRows(filters);
      const gradesByRequest = buildGradeBucketMap(gradeRows);
      const requestIds = new Set(rows.map((row) => row.requestId));
      const coveredRequestIds = [...gradesByRequest.keys()].filter((requestId) =>
        requestIds.has(requestId),
      );
      const groundingRows = gradeRows.filter((row) => row.gradeDomain === "grounding");
      const citationRows = gradeRows.filter((row) => row.gradeDomain === "citation");
      const policyRows = gradeRows.filter((row) => row.gradeDomain === "policy");
      const sampledGrades =
        gradeRows.length === 0
          ? null
          : {
              badcaseOpenCount: rows.filter(
                (row) =>
                  row.citationExpected === true &&
                  row.citationMissing === true,
              ).length,
              citationPassRate: toRatio(
                citationRows.filter((row) => row.verdict === "pass").length,
                citationRows.length,
              ),
              coverageRate: toRatio(coveredRequestIds.length, rows.length),
              groundingPassRate: toRatio(
                groundingRows.filter((row) => row.verdict === "pass").length,
                groundingRows.length,
              ),
              policyPassRate: toRatio(
                policyRows.filter((row) => row.verdict === "pass").length,
                policyRows.length,
              ),
            };

      return {
        asOf: bounds.to.toISOString(),
        runtime: {
          citationMissRate: toRatio(
            citationEligible.filter((row) => row.citationMissing === true).length,
            citationEligible.length,
          ),
          emptyRecallRate: toRatio(
            retrievalEligible.filter((row) => row.emptyRecall === true).length,
            retrievalEligible.length,
          ),
          refusalDistribution: {
            approvalRequired: rows.filter((row) => row.status === "approval_required").length,
            needsClarification: rows.filter((row) => row.status === "needs_clarification").length,
            noAnswer: rows.filter((row) => row.status === "no_answer").length,
            rejected: rows.filter((row) => row.status === "rejected").length,
          },
          requestCount: rows.length,
        },
        sampledGrades,
        window: buildResultWindow(bounds),
      } satisfies OperatorQualitySummaryResult;
    },

    async getQualityTimeseries(filters: NormalizedOperatorOverviewFilters) {
      const { bounds, granularity, rows } = await loadQualityRollupRows(filters);
      const { rows: groundingGrades } = await loadQualityGradeRows(filters, {
        gradeDomain: "grounding",
      });
      const grouped = new Map<string, MetricRollupRow[]>();
      const groundingByBucket = new Map<string, QualityGradeProjectionRow[]>();

      for (const row of rows) {
        const key = row.bucketStart.toISOString();
        const current = grouped.get(key) ?? [];
        current.push(row);
        grouped.set(key, current);
      }

      for (const row of groundingGrades) {
        const bucketKey =
          granularity === "5m"
            ? new Date(
                Date.UTC(
                  row.requestStartedAt.getUTCFullYear(),
                  row.requestStartedAt.getUTCMonth(),
                  row.requestStartedAt.getUTCDate(),
                  row.requestStartedAt.getUTCHours(),
                  row.requestStartedAt.getUTCMinutes() - (row.requestStartedAt.getUTCMinutes() % 5),
                  0,
                  0,
                ),
              ).toISOString()
            : granularity === "15m"
              ? new Date(
                  Date.UTC(
                    row.requestStartedAt.getUTCFullYear(),
                    row.requestStartedAt.getUTCMonth(),
                    row.requestStartedAt.getUTCDate(),
                    row.requestStartedAt.getUTCHours(),
                    row.requestStartedAt.getUTCMinutes() -
                      (row.requestStartedAt.getUTCMinutes() % 15),
                    0,
                    0,
                  ),
                ).toISOString()
              : granularity === "1h"
                ? new Date(
                    Date.UTC(
                      row.requestStartedAt.getUTCFullYear(),
                      row.requestStartedAt.getUTCMonth(),
                      row.requestStartedAt.getUTCDate(),
                      row.requestStartedAt.getUTCHours(),
                      0,
                      0,
                      0,
                    ),
                  ).toISOString()
                : new Date(
                    Date.UTC(
                      row.requestStartedAt.getUTCFullYear(),
                      row.requestStartedAt.getUTCMonth(),
                      row.requestStartedAt.getUTCDate(),
                      0,
                      0,
                      0,
                      0,
                    ),
                  ).toISOString();
        const current = groundingByBucket.get(bucketKey) ?? [];
        current.push(row);
        groundingByBucket.set(bucketKey, current);
      }

      return {
        asOf: bounds.to.toISOString(),
        series: [...grouped.entries()].map(([bucketStart, bucketRows]) => {
          const metrics = bucketRows.reduce(
            (acc, row) => {
              acc.requestCount += row.metricsJson.requestCount;
              acc.retrievalEligibleCount += row.metricsJson.retrievalEligibleCount;
              acc.emptyRecallCount += row.metricsJson.emptyRecallCount;
              acc.citationEligibleCount += row.metricsJson.citationEligibleCount;
              acc.citationMissCount += row.metricsJson.citationMissCount;
              acc.noAnswerCount += row.metricsJson.noAnswerCount;
              acc.needsClarificationCount += row.metricsJson.needsClarificationCount;
              return acc;
            },
            {
              citationEligibleCount: 0,
              citationMissCount: 0,
              emptyRecallCount: 0,
              needsClarificationCount: 0,
              noAnswerCount: 0,
              requestCount: 0,
              retrievalEligibleCount: 0,
            },
          );

          return {
            bucketEnd: bucketRows[0]!.bucketEnd.toISOString(),
            bucketStart,
            citationMissRate:
              metrics.citationEligibleCount > 0
                ? Number((metrics.citationMissCount / metrics.citationEligibleCount).toFixed(4))
                : 0,
            emptyRecallRate:
              metrics.retrievalEligibleCount > 0
                ? Number((metrics.emptyRecallCount / metrics.retrievalEligibleCount).toFixed(4))
                : 0,
            needsClarificationRate:
              metrics.requestCount > 0
                ? Number((metrics.needsClarificationCount / metrics.requestCount).toFixed(4))
                : 0,
            noAnswerRate:
              metrics.requestCount > 0
                ? Number((metrics.noAnswerCount / metrics.requestCount).toFixed(4))
                : 0,
            requestCount: metrics.requestCount,
            sampledGroundingPassRate: (() => {
              const gradeRows = groundingByBucket.get(bucketStart) ?? [];
              if (gradeRows.length === 0) {
                return null;
              }
              return Number(
                (
                  gradeRows.filter((row) => row.verdict === "pass").length / gradeRows.length
                ).toFixed(4),
              );
            })(),
          };
        }),
        window: {
          from: bounds.from.toISOString(),
          granularity,
          to: bounds.to.toISOString(),
        },
      } satisfies OperatorQualityTimeseriesResult;
    },

    async getSafetySummary(filters: NormalizedOperatorOverviewFilters) {
      const { bounds, rows } = await loadObservabilityRows(filters);
      const total = rows.length;

      return {
        asOf: bounds.to.toISOString(),
        summary: {
          aclAnomalyRate: toRatio(
            rows.filter((row) => Boolean(row.aclAnomalyCode)).length,
            total,
          ),
          decisionDistribution: {
            allowed: rows.filter((row) => row.aclDecision === "allowed").length,
            approvalRequired: rows.filter((row) => row.aclDecision === "approval_required").length,
            denied: rows.filter((row) => row.aclDecision === "denied").length,
            failClosed: rows.filter((row) => row.failClosed === true).length,
          },
          failClosedRate: toRatio(
            rows.filter((row) => row.failClosed === true).length,
            total,
          ),
          restrictedDenyRate: toRatio(
            rows.filter((row) => row.aclDecision === "denied").length,
            total,
          ),
        },
        window: buildResultWindow(bounds),
      } satisfies OperatorSafetySummaryResult;
    },

    async getCostSummary(filters: NormalizedOperatorOverviewFilters) {
      const { bounds, rows } = await loadObservabilityRows(filters);

      return {
        asOf: bounds.to.toISOString(),
        summary: {
          byModel: aggregateCostByModel(rows),
          bySurface: aggregateCostBySurface(rows),
          estimatedCost: {
            currency: "USD",
            microusd: sumNullableInteger(rows, (row) => row.estimatedCostMicrousd),
          },
          tokens: {
            cachedInput: sumNullableInteger(rows, (row) => row.cachedInputTokens),
            input: sumNullableInteger(rows, (row) => row.inputTokens),
            output: sumNullableInteger(rows, (row) => row.outputTokens),
          },
        },
        window: buildResultWindow(bounds),
      } satisfies OperatorCostSummaryResult;
    },

    async listQualityBadcases(filters: NormalizedOperatorQualityBadcaseListFilters) {
      const db = await getDb();
      const conditions = [];

      if (filters.status) {
        conditions.push(eq(qualityBadcaseProjection.status, filters.status));
      }
      if (filters.causeClass) {
        conditions.push(eq(qualityBadcaseProjection.causeClass, filters.causeClass));
      }
      if (filters.detectedBy) {
        conditions.push(eq(qualityBadcaseProjection.detectedBy, filters.detectedBy));
      }

      const baseQuery =
        conditions.length > 0
          ? db.select().from(qualityBadcaseProjection).where(and(...conditions))
          : db.select().from(qualityBadcaseProjection);
      const rows = await baseQuery
        .orderBy(desc(qualityBadcaseProjection.openedAt), desc(qualityBadcaseProjection.badcaseId))
        .limit(filters.limit + 1);
      const visibleRows = rows.slice(0, filters.limit);
      const backlinksByRequestId = await loadTraceBacklinksByRequestIds(
        db,
        visibleRows.map((row) => row.requestId),
      );
      const gradeDomainsByRequest = new Map<string, string>();
      for (const row of visibleRows) {
        const inferred = inferGradeDomainFromCauseClass(row.causeClass);
        if (inferred) {
          gradeDomainsByRequest.set(row.requestId, inferred);
        }
      }
      const gradeRows =
        gradeDomainsByRequest.size === 0
          ? []
          : await db
              .select()
              .from(qualityGradeProjection)
              .where(inArray(qualityGradeProjection.requestId, [...gradeDomainsByRequest.keys()]))
              .orderBy(
                desc(qualityGradeProjection.requestStartedAt),
                desc(qualityGradeProjection.sampledAt),
                desc(qualityGradeProjection.gradeId),
              );
      const latestGrades = buildGradeBucketMap(gradeRows);

      const items = visibleRows.map((row) => {
        const inferredDomain = gradeDomainsByRequest.get(row.requestId) ?? null;
        const latestGrade =
          inferredDomain
            ? latestGrades.get(row.requestId)?.byDomain.get(inferredDomain) ?? null
            : latestGrades.get(row.requestId)?.latest ?? null;
        return {
        badcaseId: row.badcaseId,
        causeClass: row.causeClass,
        detectedBy: row.detectedBy,
        grade:
          latestGrade
            ? {
                graderVersion: latestGrade.graderVersion,
                result: latestGrade.verdict,
                score: toScore(latestGrade.scoreMilli),
              }
            : row.gradeJson,
        links: toLinks(backlinksByRequestId.get(row.requestId)),
        openedAt: row.openedAt.toISOString(),
        requestId: row.requestId,
        selectedTarget: row.selectedTarget ?? null,
        status: row.status,
        summary: row.summary,
        surface: row.surface,
        traceId: row.traceId,
      };
      });
      const nextRow = rows[filters.limit];

      return {
        badcases: items,
        page: {
          nextCursor: nextRow ? nextRow.badcaseId : null,
        },
      } satisfies OperatorQualityBadcaseListResult;
    },

    async list(filters: NormalizedOperatorRequestListFilters) {
      const db = await getDb();
      const conditions = [];

      if (filters.q) {
        const pattern = `%${escapeLikePattern(filters.q)}%`;
        conditions.push(
          or(
            ilike(requestProjection.requestId, pattern),
            ilike(requestProjection.questionPreview, pattern),
            ilike(requestProjection.principalId, pattern),
            ilike(requestProjection.principalLabel, pattern),
            ilike(requestProjection.conversationId, pattern),
            ilike(requestProjection.errorCode, pattern),
          )!,
        );
      }
      if (filters.status) {
        conditions.push(eq(requestProjection.status, filters.status));
      }
      if (filters.surface) {
        conditions.push(eq(requestProjection.surface, filters.surface));
      }
      if (filters.conversationId) {
        conditions.push(eq(requestProjection.conversationId, filters.conversationId));
      }
      if (filters.requestId) {
        conditions.push(eq(requestProjection.requestId, filters.requestId));
      }

      if (filters.cursor) {
        const cursor = decodeCursor(filters.cursor);
        if (cursor) {
          conditions.push(
            or(
              lt(requestProjection.startedAt, new Date(cursor.startedAt)),
              and(
                eq(requestProjection.startedAt, new Date(cursor.startedAt)),
                lt(requestProjection.requestId, cursor.requestId),
              ),
            )!,
          );
        }
      }

      const baseQuery =
        conditions.length > 0
          ? db.select().from(requestProjection).where(and(...conditions))
          : db.select().from(requestProjection);
      const rows = await baseQuery
        .orderBy(desc(requestProjection.startedAt), desc(requestProjection.requestId))
        .limit(filters.limit + 1);

      const items = rows.slice(0, filters.limit).map(toRequestProjectionRecord);
      const nextRow = rows[filters.limit];

      return {
        page: {
          nextCursor: nextRow
            ? encodeCursor({
                requestId: nextRow.requestId,
                startedAt: nextRow.startedAt.toISOString(),
              })
            : null,
        },
        requests: items,
      } satisfies OperatorQueryListResult;
    },

    async listAudit(filters: NormalizedOperatorAuditListFilters) {
      const db = await getDb();
      const conditions = [];

      if (filters.requestId) {
        conditions.push(eq(requestAuditProjection.requestId, filters.requestId));
      }
      if (filters.traceId) {
        conditions.push(eq(requestAuditProjection.traceId, filters.traceId));
      }
      if (filters.principalType) {
        conditions.push(eq(requestAuditProjection.principalType, filters.principalType));
      }
      if (filters.surface) {
        conditions.push(eq(requestAuditProjection.surface, filters.surface));
      }
      if (filters.selectedTarget) {
        conditions.push(eq(requestAuditProjection.selectedTarget, filters.selectedTarget));
      }
      if (filters.eventType) {
        conditions.push(eq(requestAuditProjection.eventType, filters.eventType));
      }
      if (filters.status) {
        conditions.push(eq(requestAuditProjection.status, filters.status));
      }

      if (filters.cursor) {
        const cursor = decodeAuditCursor(filters.cursor);
        if (cursor) {
          conditions.push(
            or(
              lt(requestAuditProjection.occurredAt, new Date(cursor.occurredAt)),
              and(
                eq(requestAuditProjection.occurredAt, new Date(cursor.occurredAt)),
                lt(requestAuditProjection.auditEventId, cursor.auditEventId),
              ),
            )!,
          );
        }
      }

      const baseQuery =
        conditions.length > 0
          ? db.select().from(requestAuditProjection).where(and(...conditions))
          : db.select().from(requestAuditProjection);
      const rows = await baseQuery
        .orderBy(desc(requestAuditProjection.occurredAt), desc(requestAuditProjection.auditEventId))
        .limit(filters.limit + 1);

      const items = rows.slice(0, filters.limit).map(toAuditListItem);
      const nextRow = rows[filters.limit];

      return {
        events: items,
        page: {
          nextCursor: nextRow
            ? encodeAuditCursor({
                auditEventId: nextRow.auditEventId,
                occurredAt: nextRow.occurredAt.toISOString(),
              })
            : null,
        },
      } satisfies OperatorAuditListResult;
    },
  };
}
