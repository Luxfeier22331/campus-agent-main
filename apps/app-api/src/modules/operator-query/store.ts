import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDatabase } from "../../db/runtime";
import { requestProjection } from "../../db/schema";
import type {
  NormalizedOperatorRequestListFilters,
  OperatorQueryListResult,
  OperatorQueryStore,
  RequestProjectionRecord,
} from "./service";

interface RequestProjectionCursor {
  requestId: string;
  startedAt: string;
}

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

export function createPgOperatorQueryStore(env: Env): OperatorQueryStore {
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
