import { and, desc, eq, gte, lt, lte, or } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase } from "../../db/runtime";
import { requestObservabilityFact, requestProjection } from "../../db/schema";
import type {
  MetricRatio,
  OperatorCostSummaryResult,
  NormalizedOperatorOverviewFilters,
  NormalizedOperatorRequestListFilters,
  OperatorOverviewResult,
  OperatorOverviewWindow,
  OperatorQualitySummaryResult,
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

type RequestObservabilityFactRow = typeof requestObservabilityFact.$inferSelect;

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
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

function encodeCursor(input: RequestProjectionCursor): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): RequestProjectionCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<RequestProjectionCursor>;

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
    now?: () => Date;
  } = {},
): OperatorQueryStore {
  const now = input.now ?? (() => new Date());

  async function loadObservabilityRows(filters: NormalizedOperatorOverviewFilters) {
    const db = await createRuntimeDatabase(env);
    const bounds = resolveWindowBounds(filters.window, now());
    const rows = await db
      .select()
      .from(requestObservabilityFact)
      .where(and(...buildObservabilityConditions(filters, bounds)));

    return { bounds, rows };
  }

  return {
    async getById(requestId) {
      const db = await createRuntimeDatabase(env);
      const rows = await db
        .select()
        .from(requestProjection)
        .where(eq(requestProjection.requestId, requestId))
        .limit(1);

      return rows[0] ? toRequestProjectionRecord(rows[0]) : null;
    },

    async getObservabilityById(requestId) {
      const db = await createRuntimeDatabase(env);
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
      const sourceDocIds = projection.sourceDocIdsJson ?? [];

      return {
        auditSummary: {
          auditEventCount: 0,
          latestTerminalCode: projection.status,
        },
        links: {
          issueFingerprint: null,
          issueLink: null,
          traceLink: null,
        },
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
        sampledGrades: null,
        window: buildResultWindow(bounds),
      } satisfies OperatorQualitySummaryResult;
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

    async list(filters: NormalizedOperatorRequestListFilters) {
      const db = await createRuntimeDatabase(env);
      const conditions = [];

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
  };
}
