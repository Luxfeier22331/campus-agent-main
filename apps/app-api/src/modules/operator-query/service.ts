import { AppApiRouteError } from "../../http";
import type { RequestDiagnosticsSummary } from "../request-diagnostics";
import type { ResolvedAppPrincipal } from "../auth";
import type { RequestExecutionStatus } from "../runtime-command";

export interface RequestProjectionRecord {
  requestId: string;
  traceId: string;
  surface: string;
  conversationId: string;
  principalType: string;
  principalId: string;
  principalLabel: string | null;
  requestedCapability: string | null;
  requestedScope: Record<string, unknown> | null;
  selectedTarget: string | null;
  status: RequestExecutionStatus;
  errorCode: string | null;
  questionPreview: string;
  answerPreview: string | null;
  diagnostics?: RequestDiagnosticsSummary;
  sourceDocIds: string[];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  projectedAt: string;
}

export interface OperatorRequestListFilters {
  limit?: number | null;
  cursor?: string | null;
  status?: string | null;
  surface?: string | null;
  conversationId?: string | null;
  requestId?: string | null;
}

export interface NormalizedOperatorRequestListFilters {
  limit: number;
  cursor: string | null;
  status: string | null;
  surface: string | null;
  conversationId: string | null;
  requestId: string | null;
}

export interface OperatorQueryListResult {
  requests: RequestProjectionRecord[];
  page: {
    nextCursor: string | null;
  };
}

export interface OperatorQueryStore {
  getById(requestId: string): Promise<RequestProjectionRecord | null>;
  list(filters: NormalizedOperatorRequestListFilters): Promise<OperatorQueryListResult>;
}

export interface OperatorQueryService {
  getById(input: {
    principal: ResolvedAppPrincipal;
    requestId: string;
  }): Promise<RequestProjectionRecord>;
  list(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorRequestListFilters;
  }): Promise<OperatorQueryListResult>;
}

export interface OperatorQueryServiceDependencies {
  store: OperatorQueryStore;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.floor(value), MAX_LIMIT);
}

function ensureOperatorPrincipal(principal: ResolvedAppPrincipal): void {
  if (!principal.permissions.operator) {
    throw new AppApiRouteError({
      code: "forbidden",
      message: "Operator access is not available for this principal.",
      retryable: false,
      status: 403,
    });
  }
}

export function buildOperatorQueryService(
  dependencies: OperatorQueryServiceDependencies,
): OperatorQueryService {
  return {
    async getById(input) {
      ensureOperatorPrincipal(input.principal);
      const requestId = normalizeOptionalString(input.requestId);
      if (!requestId) {
        throw new AppApiRouteError({
          code: "invalid_request_id",
          message: "requestId is required.",
          retryable: false,
          status: 400,
        });
      }

      const projection = await dependencies.store.getById(requestId);
      if (!projection) {
        throw new AppApiRouteError({
          code: "request_not_found",
          message: "Request projection not found.",
          retryable: false,
          status: 404,
        });
      }

      return projection;
    },

    async list(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.list({
        conversationId: normalizeOptionalString(input.filters.conversationId),
        cursor: normalizeOptionalString(input.filters.cursor),
        limit: normalizeLimit(input.filters.limit),
        requestId: normalizeOptionalString(input.filters.requestId),
        status: normalizeOptionalString(input.filters.status),
        surface: normalizeOptionalString(input.filters.surface),
      } satisfies NormalizedOperatorRequestListFilters);
    },
  };
}
