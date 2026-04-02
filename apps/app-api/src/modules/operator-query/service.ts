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
  entitlementSnapshotId: string | null;
  entitlementGroups: string[];
  visibilityScope: string | null;
  applicabilityScope: string | null;
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

export interface OperatorAuditListFilters {
  limit?: number | null;
  cursor?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  principalType?: string | null;
  surface?: string | null;
  selectedTarget?: string | null;
  eventType?: string | null;
  status?: string | null;
}

export interface NormalizedOperatorRequestListFilters {
  limit: number;
  cursor: string | null;
  status: string | null;
  surface: string | null;
  conversationId: string | null;
  requestId: string | null;
}

export interface NormalizedOperatorAuditListFilters {
  limit: number;
  cursor: string | null;
  requestId: string | null;
  traceId: string | null;
  principalType: string | null;
  surface: string | null;
  selectedTarget: string | null;
  eventType: string | null;
  status: string | null;
}

export interface OperatorOverviewFilters {
  window?: string | null;
  surface?: string | null;
  selectedTarget?: string | null;
  requestedCapability?: string | null;
  principalType?: string | null;
  collection?: string | null;
  modelName?: string | null;
}

export interface NormalizedOperatorOverviewFilters {
  window: OperatorOverviewWindow;
  surface: string | null;
  selectedTarget: string | null;
  requestedCapability: string | null;
  principalType: string | null;
  collection: string | null;
  modelName: string | null;
}

export interface OperatorQueryListResult {
  requests: RequestProjectionRecord[];
  page: {
    nextCursor: string | null;
  };
}

export type OperatorOverviewWindow = "15m" | "1h" | "24h" | "7d" | "30d";

export interface MetricRatio {
  value: number;
  count: number;
  eligibleCount: number | null;
}

export interface OperatorResultWindow {
  from: string;
  to: string;
  granularity: "5m" | "15m" | "1h" | "1d";
}

export interface OperatorRequestObservabilityRecord {
  request: {
    requestId: string;
    traceId: string;
    conversationId: string;
    surface: string;
    status: RequestExecutionStatus;
    requestedCapability: string | null;
    requestedScope: Record<string, unknown> | null;
    selectedTarget: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  observability: {
    durationMs: number | null;
    retrievalAttempted: boolean | null;
    candidateCount: number | null;
    retrievedSourceCount: number | null;
    emptyRecall: boolean | null;
    citationExpected: boolean | null;
    citationCount: number | null;
    citationMissing: boolean | null;
    refusalClass: string | null;
    aclDecision: string | null;
    aclAnomalyCode: string | null;
    failClosed: boolean | null;
    model: {
      provider: string | null;
      name: string | null;
    };
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    estimatedCost: {
      microusd: number | null;
      currency: "USD";
    };
    traceAvailable: boolean;
    projectionLagMs: number | null;
    measuredAt: string | null;
  };
  links: {
    traceLink: string | null;
    issueLink: string | null;
    issueFingerprint: string | null;
  };
  auditSummary: {
    auditEventCount: number;
    latestTerminalCode: string | null;
  };
}

export interface OperatorOverviewResult {
  window: OperatorResultWindow;
  overview: {
    requestVolume: {
      accepted: number;
      completed: number;
      errored: number;
    };
    latency: {
      p50Ms: number | null;
      p95Ms: number | null;
      p99Ms: number | null;
    };
    failureRate: MetricRatio;
    emptyRecallRate: MetricRatio;
    citationMissRate: MetricRatio;
    refusalRate: MetricRatio;
    aclAnomalyRate: MetricRatio;
    estimatedCost: {
      microusd: number;
      currency: "USD";
    };
    sinkHealth: {
      missingTraceRate: MetricRatio;
      projectionFailureCount: number;
    };
  };
  alerts: Array<{
    alertId: string;
    domain: string;
    severity: string;
    code: string;
    status: string;
    startedAt: string;
  }>;
  asOf: string;
}

export interface OperatorAuditEventListItem {
  auditEventId: string;
  requestId: string;
  traceId: string;
  occurredAt: string;
  eventType: string;
  surface: string;
  principalType: string;
  selectedTarget: string | null;
  status: string;
  summary: string;
}

export interface OperatorAuditEventDetail {
  event: {
    auditEventId: string;
    requestId: string;
    traceId: string;
    occurredAt: string;
    eventType: string;
    surface: string;
    principalType: string;
    entitlementSnapshotId: string | null;
    policyProjectionVersion: string | null;
    requestedCapability: string | null;
    selectedTarget: string | null;
    status: string;
    terminalCode: string | null;
    summary: string;
    diagnostics: {
      failClosed: boolean | null;
      aclAnomalyCode: string | null;
      sourceDocIds: string[];
    };
  };
  links: {
    traceLink: string | null;
    issueLink: string | null;
    issueFingerprint: string | null;
  };
}

export interface OperatorAuditListResult {
  events: OperatorAuditEventListItem[];
  page: {
    nextCursor: string | null;
  };
}

export interface OperatorQualitySummaryResult {
  window: OperatorResultWindow;
  runtime: {
    requestCount: number;
    emptyRecallRate: MetricRatio;
    citationMissRate: MetricRatio;
    refusalDistribution: {
      noAnswer: number;
      needsClarification: number;
      approvalRequired: number;
      rejected: number;
    };
  };
  sampledGrades: {
    coverageRate: MetricRatio | null;
    groundingPassRate: MetricRatio | null;
    citationPassRate: MetricRatio | null;
    policyPassRate: MetricRatio | null;
    badcaseOpenCount: number | null;
  } | null;
  asOf: string;
}

export interface OperatorSafetySummaryResult {
  window: OperatorResultWindow;
  summary: {
    decisionDistribution: {
      allowed: number;
      approvalRequired: number;
      denied: number;
      failClosed: number;
    };
    aclAnomalyRate: MetricRatio;
    restrictedDenyRate: MetricRatio;
    failClosedRate: MetricRatio;
  };
  asOf: string;
}

export interface OperatorCostSummaryResult {
  window: OperatorResultWindow;
  summary: {
    tokens: {
      input: number;
      output: number;
      cachedInput: number;
    };
    estimatedCost: {
      microusd: number;
      currency: "USD";
    };
    byModel: Array<{
      modelName: string;
      requestCount: number;
      estimatedCostMicrousd: number;
    }>;
    bySurface: Array<{
      surface: string;
      requestCount: number;
      estimatedCostMicrousd: number;
    }>;
  };
  asOf: string;
}

export interface OperatorQueryStore {
  getById(requestId: string): Promise<RequestProjectionRecord | null>;
  getAuditById(auditEventId: string): Promise<OperatorAuditEventDetail | null>;
  getObservabilityById(requestId: string): Promise<OperatorRequestObservabilityRecord | null>;
  getOverview(filters: NormalizedOperatorOverviewFilters): Promise<OperatorOverviewResult>;
  getQualitySummary(filters: NormalizedOperatorOverviewFilters): Promise<OperatorQualitySummaryResult>;
  getSafetySummary(filters: NormalizedOperatorOverviewFilters): Promise<OperatorSafetySummaryResult>;
  getCostSummary(filters: NormalizedOperatorOverviewFilters): Promise<OperatorCostSummaryResult>;
  listAudit(filters: NormalizedOperatorAuditListFilters): Promise<OperatorAuditListResult>;
  list(filters: NormalizedOperatorRequestListFilters): Promise<OperatorQueryListResult>;
}

export interface OperatorQueryService {
  getById(input: {
    principal: ResolvedAppPrincipal;
    requestId: string;
  }): Promise<RequestProjectionRecord>;
  getObservabilityById(input: {
    principal: ResolvedAppPrincipal;
    requestId: string;
  }): Promise<OperatorRequestObservabilityRecord>;
  getAuditById(input: {
    principal: ResolvedAppPrincipal;
    auditEventId: string;
  }): Promise<OperatorAuditEventDetail>;
  getOverview(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorOverviewFilters;
  }): Promise<OperatorOverviewResult>;
  getQualitySummary(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorOverviewFilters;
  }): Promise<OperatorQualitySummaryResult>;
  getSafetySummary(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorOverviewFilters;
  }): Promise<OperatorSafetySummaryResult>;
  getCostSummary(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorOverviewFilters;
  }): Promise<OperatorCostSummaryResult>;
  list(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorRequestListFilters;
  }): Promise<OperatorQueryListResult>;
  listAudit(input: {
    principal: ResolvedAppPrincipal;
    filters: OperatorAuditListFilters;
  }): Promise<OperatorAuditListResult>;
}

export interface OperatorQueryServiceDependencies {
  store: OperatorQueryStore;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_WINDOW: OperatorOverviewWindow = "24h";
const OPERATOR_WINDOWS = new Set<OperatorOverviewWindow>(["15m", "1h", "24h", "7d", "30d"]);

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

function normalizeOverviewWindow(value: string | null | undefined): OperatorOverviewWindow {
  const normalized = normalizeOptionalString(value);
  if (normalized && OPERATOR_WINDOWS.has(normalized as OperatorOverviewWindow)) {
    return normalized as OperatorOverviewWindow;
  }

  return DEFAULT_WINDOW;
}

function normalizeOverviewFilters(
  filters: OperatorOverviewFilters,
): NormalizedOperatorOverviewFilters {
  return {
    collection: normalizeOptionalString(filters.collection),
    modelName: normalizeOptionalString(filters.modelName),
    principalType: normalizeOptionalString(filters.principalType),
    requestedCapability: normalizeOptionalString(filters.requestedCapability),
    selectedTarget: normalizeOptionalString(filters.selectedTarget),
    surface: normalizeOptionalString(filters.surface),
    window: normalizeOverviewWindow(filters.window),
  };
}

function normalizeAuditListFilters(
  filters: OperatorAuditListFilters,
): NormalizedOperatorAuditListFilters {
  return {
    cursor: normalizeOptionalString(filters.cursor),
    eventType: normalizeOptionalString(filters.eventType),
    limit: normalizeLimit(filters.limit),
    principalType: normalizeOptionalString(filters.principalType),
    requestId: normalizeOptionalString(filters.requestId),
    selectedTarget: normalizeOptionalString(filters.selectedTarget),
    status: normalizeOptionalString(filters.status),
    surface: normalizeOptionalString(filters.surface),
    traceId: normalizeOptionalString(filters.traceId),
  };
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

    async getObservabilityById(input) {
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

      const projection = await dependencies.store.getObservabilityById(requestId);
      if (!projection) {
        throw new AppApiRouteError({
          code: "request_not_found",
          message: "Request observability not found.",
          retryable: false,
          status: 404,
        });
      }

      return projection;
    },

    async getAuditById(input) {
      ensureOperatorPrincipal(input.principal);
      const auditEventId = normalizeOptionalString(input.auditEventId);
      if (!auditEventId) {
        throw new AppApiRouteError({
          code: "invalid_audit_event_id",
          message: "auditEventId is required.",
          retryable: false,
          status: 400,
        });
      }

      const event = await dependencies.store.getAuditById(auditEventId);
      if (!event) {
        throw new AppApiRouteError({
          code: "audit_event_not_found",
          message: "Audit event not found.",
          retryable: false,
          status: 404,
        });
      }

      return event;
    },

    async getOverview(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.getOverview(normalizeOverviewFilters(input.filters));
    },

    async getQualitySummary(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.getQualitySummary(normalizeOverviewFilters(input.filters));
    },

    async getSafetySummary(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.getSafetySummary(normalizeOverviewFilters(input.filters));
    },

    async getCostSummary(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.getCostSummary(normalizeOverviewFilters(input.filters));
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

    async listAudit(input) {
      ensureOperatorPrincipal(input.principal);

      return dependencies.store.listAudit(normalizeAuditListFilters(input.filters));
    },
  };
}
