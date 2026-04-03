import type { RequestExecutionStatus } from "../runtime-command";
import type { RequestDiagnosticsSummary } from "../request-diagnostics";

export interface ProjectionOutboxEvent {
  eventId: string;
  requestId: string;
  eventType: string;
  occurredAt: string;
  availableAt: string;
  processedAt: string | null;
  attemptCount: number;
}

export interface RequestExecutionProjectionSource {
  aclAnomalyCode: string | null;
  aclDecision: string | null;
  requestId: string;
  traceId: string;
  surface: string;
  conversationId: string;
  principalId: string;
  principalType: string;
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
  diagnostics: RequestDiagnosticsSummary | null;
  failClosed: boolean | null;
  citationExpected: boolean | null;
  citationMissing: boolean | null;
  emptyRecall: boolean | null;
  modelName: string | null;
  policyProjectionVersion: string | null;
  retrievalAttempted: boolean | null;
  sourceDocIds: string[];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  projectedAtHint?: string | null;
}

export interface RequestProjectionMaterialization {
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
  diagnostics: RequestDiagnosticsSummary | null;
  sourceDocIds: string[];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  projectedAt: string;
}

export interface RequestAuditProjectionMaterialization {
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
  status: RequestExecutionStatus;
  terminalCode: RequestExecutionStatus | null;
  summary: string;
  diagnostics: {
    failClosed: boolean | null;
    aclAnomalyCode: string | null;
    sourceDocIds: string[];
  };
  projectedAt: string;
}

export interface MetricRollupMaterialization {
  rollupId: string;
  requestId: string;
  domain: "quality";
  granularity: "5m" | "15m" | "1h" | "1d";
  bucketStart: string;
  bucketEnd: string;
  surface: string;
  selectedTarget: string | null;
  requestedCapability: string | null;
  principalType: string;
  collection: string | null;
  modelName: string | null;
  metrics: {
    approvalRequiredCount: number;
    citationEligibleCount: number;
    citationMissCount: number;
    emptyRecallCount: number;
    needsClarificationCount: number;
    noAnswerCount: number;
    rejectedCount: number;
    requestCount: number;
    retrievalEligibleCount: number;
  };
  projectedAt: string;
}

export interface QualityBadcaseProjectionMaterialization {
  badcaseId: string;
  requestId: string;
  traceId: string;
  surface: string;
  selectedTarget: string | null;
  status: "open";
  causeClass: string;
  detectedBy: "runtime_monitor";
  openedAt: string;
  summary: string;
  grade: null;
  projectedAt: string;
}

export interface RequestProjectionProjectorStore {
  getRequestExecution(requestId: string): Promise<RequestExecutionProjectionSource | null>;
  listPendingEvents(limit: number, now: Date): Promise<ProjectionOutboxEvent[]>;
  listPendingEventsForRequest?(requestId: string, now: Date): Promise<ProjectionOutboxEvent[]>;
  markEventFailed(input: {
    eventId: string;
    attemptCount: number;
    availableAt: string;
    lastError: string;
    processedAt: string | null;
  }): Promise<void>;
  markEventProcessed(input: { eventId: string; processedAt: string }): Promise<void>;
  markObservabilityProjected(input: {
    requestId: string;
    projectionLagMs: number | null;
    measuredAt: string;
  }): Promise<void>;
  replaceQualityRollups(input: { requestId: string; rollups: MetricRollupMaterialization[] }): Promise<void>;
  replaceQualityBadcases(input: {
    requestId: string;
    badcases: QualityBadcaseProjectionMaterialization[];
  }): Promise<void>;
  upsertAuditProjection(projection: RequestAuditProjectionMaterialization): Promise<void>;
  upsertProjection(projection: RequestProjectionMaterialization): Promise<void>;
}

export interface RequestProjectionProjector {
  drain(input?: { limit?: number }): Promise<{ processed: number; failed: number }>;
  drainRequest(requestId: string): Promise<{ processed: number; failed: number }>;
}

export interface RequestProjectionProjectorDependencies {
  now?: () => Date;
  store: RequestProjectionProjectorStore;
}

const DEFAULT_DRAIN_LIMIT = 50;
const MAX_PROJECTION_ATTEMPTS = 5;
const PROJECTION_RETRY_BASE_DELAY_MS = 5_000;
const PROJECTION_RETRY_MAX_DELAY_MS = 5 * 60_000;

function computeRetryDelayMs(attemptCount: number): number {
  return Math.min(
    PROJECTION_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
    PROJECTION_RETRY_MAX_DELAY_MS,
  );
}

function computeProjectionLagMs(input: {
  projectedAt: string;
  startedAt: string;
}): number | null {
  const projectedAtMs = Date.parse(input.projectedAt);
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(projectedAtMs) || !Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, projectedAtMs - startedAtMs);
}

function resolveAuditEventStatus(
  eventType: string,
  execution: RequestExecutionProjectionSource,
): RequestExecutionStatus {
  switch (eventType) {
    case "request.accepted":
      return "accepted";
    case "request.completed":
      return "completed";
    case "request.needs_clarification":
      return "needs_clarification";
    case "request.no_answer":
      return "no_answer";
    case "request.error":
      return "error";
    case "request.approval_required":
      return "approval_required";
    case "request.rejected":
      return "rejected";
    default:
      return execution.status;
  }
}

function toAuditCapabilityLabel(requestedCapability: string | null): string {
  if (!requestedCapability) {
    return "Request";
  }

  return `${requestedCapability.slice(0, 1).toUpperCase()}${requestedCapability.slice(1)} request`;
}

function buildAuditSummary(input: {
  eventType: string;
  execution: RequestExecutionProjectionSource;
  status: RequestExecutionStatus;
}): string {
  const capabilityLabel = toAuditCapabilityLabel(input.execution.requestedCapability);
  const targetSuffix = input.execution.selectedTarget
    ? ` via ${input.execution.selectedTarget}`
    : "";

  switch (input.status) {
    case "accepted":
      return `${capabilityLabel} accepted.`;
    case "completed":
      return `${capabilityLabel} completed${targetSuffix}.`;
    case "needs_clarification":
      return `${capabilityLabel} requires clarification.`;
    case "no_answer":
      return `${capabilityLabel} returned no answer.`;
    case "approval_required":
      return `${capabilityLabel} requires approval before execution continues.`;
    case "rejected":
      return `${capabilityLabel} was rejected by supervisor policy.`;
    case "error":
      return `${capabilityLabel} ended with ${input.execution.errorCode ?? "internal_error"}.`;
    default:
      return `${capabilityLabel} recorded audit event ${input.eventType}.`;
  }
}

function parseRequestedCollection(requestedScope: Record<string, unknown> | null): string | null {
  const collection = requestedScope?.collection;
  return typeof collection === "string" && collection ? collection : null;
}

function resolveBucketStart(timestamp: string, granularity: MetricRollupMaterialization["granularity"]): Date {
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

function addGranularity(bucketStart: Date, granularity: MetricRollupMaterialization["granularity"]): Date {
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

function buildMetricRollupId(input: {
  domain: "quality";
  granularity: MetricRollupMaterialization["granularity"];
  bucketStart: string;
  surface: string;
  selectedTarget: string | null;
  requestedCapability: string | null;
  principalType: string;
  collection: string | null;
  modelName: string | null;
  requestId: string;
}): string {
  return [
    input.domain,
    input.granularity,
    input.bucketStart,
    input.surface,
    input.selectedTarget ?? "_",
    input.requestedCapability ?? "_",
    input.principalType,
    input.collection ?? "_",
    input.modelName ?? "_",
    input.requestId,
  ].join("|");
}

function buildQualityRollups(input: {
  execution: RequestExecutionProjectionSource;
  projectedAt: string;
}): MetricRollupMaterialization[] {
  const metrics = {
    approvalRequiredCount: input.execution.status === "approval_required" ? 1 : 0,
    citationEligibleCount: input.execution.citationExpected === true ? 1 : 0,
    citationMissCount: input.execution.citationMissing === true ? 1 : 0,
    emptyRecallCount: input.execution.emptyRecall === true ? 1 : 0,
    needsClarificationCount: input.execution.status === "needs_clarification" ? 1 : 0,
    noAnswerCount: input.execution.status === "no_answer" ? 1 : 0,
    rejectedCount: input.execution.status === "rejected" ? 1 : 0,
    requestCount: 1,
    retrievalEligibleCount: input.execution.retrievalAttempted === true ? 1 : 0,
  };

  return ([
    "5m",
    "15m",
    "1h",
    "1d",
  ] as const).map((granularity) => {
    const bucketStart = resolveBucketStart(input.execution.startedAt, granularity);
    const bucketStartIso = bucketStart.toISOString();
    return {
      bucketEnd: addGranularity(bucketStart, granularity).toISOString(),
      bucketStart: bucketStartIso,
      collection: parseRequestedCollection(input.execution.requestedScope),
      domain: "quality",
      granularity,
      metrics,
      modelName: input.execution.modelName ?? null,
      principalType: input.execution.principalType,
      projectedAt: input.projectedAt,
      requestId: input.execution.requestId,
      requestedCapability: input.execution.requestedCapability,
      rollupId: buildMetricRollupId({
        bucketStart: bucketStartIso,
        collection: parseRequestedCollection(input.execution.requestedScope),
        domain: "quality",
        granularity,
        modelName: input.execution.modelName ?? null,
        principalType: input.execution.principalType,
        requestId: input.execution.requestId,
        requestedCapability: input.execution.requestedCapability,
        selectedTarget: input.execution.selectedTarget,
        surface: input.execution.surface,
      }),
      selectedTarget: input.execution.selectedTarget,
      surface: input.execution.surface,
    };
  });
}

function buildQualityBadcases(input: {
  execution: RequestExecutionProjectionSource;
  projectedAt: string;
}): QualityBadcaseProjectionMaterialization[] {
  const badcases: Array<{ causeClass: string; summary: string }> = [];

  if (input.execution.citationExpected === true && input.execution.citationMissing === true) {
    badcases.push({
      causeClass: "citation_missing",
      summary: "citationExpected=true 但 citationCount=0",
    });
  }
  if (input.execution.retrievalAttempted === true && input.execution.emptyRecall === true) {
    badcases.push({
      causeClass: "empty_recall",
      summary: "retrievalAttempted=true 但 retrievedSourceCount=0",
    });
  }

  return badcases.map((badcase) => ({
    badcaseId: `${input.execution.requestId}:${badcase.causeClass}`,
    causeClass: badcase.causeClass,
    detectedBy: "runtime_monitor",
    grade: null,
    openedAt: input.execution.completedAt ?? input.execution.startedAt,
    projectedAt: input.projectedAt,
    requestId: input.execution.requestId,
    selectedTarget: input.execution.selectedTarget,
    status: "open",
    summary: badcase.summary,
    surface: input.execution.surface,
    traceId: input.execution.traceId,
  }));
}

export function toRequestProjectionMaterialization(input: {
  execution: RequestExecutionProjectionSource;
  projectedAt: string;
}): RequestProjectionMaterialization {
  return {
    answerPreview: input.execution.answerPreview,
    completedAt: input.execution.completedAt,
    conversationId: input.execution.conversationId,
    durationMs: input.execution.durationMs,
    errorCode: input.execution.errorCode,
    principalId: input.execution.principalId,
    principalLabel: input.execution.principalLabel,
    principalType: input.execution.principalType,
    entitlementSnapshotId: input.execution.entitlementSnapshotId,
    entitlementGroups: input.execution.entitlementGroups,
    visibilityScope: input.execution.visibilityScope,
    applicabilityScope: input.execution.applicabilityScope,
    projectedAt: input.projectedAt,
    questionPreview: input.execution.questionPreview,
    requestId: input.execution.requestId,
    requestedCapability: input.execution.requestedCapability,
    requestedScope: input.execution.requestedScope,
    selectedTarget: input.execution.selectedTarget,
    diagnostics: input.execution.diagnostics,
    sourceDocIds: input.execution.sourceDocIds,
    startedAt: input.execution.startedAt,
    status: input.execution.status,
    surface: input.execution.surface,
    traceId: input.execution.traceId,
  };
}

export function toRequestAuditProjectionMaterialization(input: {
  event: ProjectionOutboxEvent;
  execution: RequestExecutionProjectionSource;
  projectedAt: string;
}): RequestAuditProjectionMaterialization {
  const status = resolveAuditEventStatus(input.event.eventType, input.execution);

  return {
    auditEventId: input.event.eventId,
    diagnostics: {
      aclAnomalyCode: input.execution.aclAnomalyCode,
      failClosed: input.execution.failClosed,
      sourceDocIds: input.execution.sourceDocIds,
    },
    entitlementSnapshotId: input.execution.entitlementSnapshotId,
    eventType: input.event.eventType,
    occurredAt: input.event.occurredAt,
    policyProjectionVersion: input.execution.policyProjectionVersion,
    principalType: input.execution.principalType,
    projectedAt: input.projectedAt,
    requestId: input.execution.requestId,
    requestedCapability: input.execution.requestedCapability,
    selectedTarget: input.execution.selectedTarget,
    status,
    summary: buildAuditSummary({
      eventType: input.event.eventType,
      execution: input.execution,
      status,
    }),
    surface: input.execution.surface,
    terminalCode:
      input.execution.status === "accepted"
        ? null
        : input.execution.status,
    traceId: input.execution.traceId,
  };
}

export function buildRequestProjectionProjector(
  dependencies: RequestProjectionProjectorDependencies,
): RequestProjectionProjector {
  const now = dependencies.now ?? (() => new Date());

  async function materializeEvents(events: ProjectionOutboxEvent[]) {
    let processed = 0;
    let failed = 0;

    for (const event of events) {
      const projectedAt = now().toISOString();

      try {
        const execution = await dependencies.store.getRequestExecution(event.requestId);
        if (!execution) {
          throw new Error(`Missing request_execution for ${event.requestId}.`);
        }

        await dependencies.store.upsertProjection(
          toRequestProjectionMaterialization({
            execution,
            projectedAt,
          }),
        );
        await dependencies.store.upsertAuditProjection(
          toRequestAuditProjectionMaterialization({
            event,
            execution,
            projectedAt,
          }),
        );
        await dependencies.store.replaceQualityRollups({
          requestId: execution.requestId,
          rollups: buildQualityRollups({
            execution,
            projectedAt,
          }),
        });
        await dependencies.store.replaceQualityBadcases({
          badcases: buildQualityBadcases({
            execution,
            projectedAt,
          }),
          requestId: execution.requestId,
        });
        await dependencies.store.markObservabilityProjected({
          measuredAt: projectedAt,
          projectionLagMs: computeProjectionLagMs({
            projectedAt,
            startedAt: execution.startedAt,
          }),
          requestId: execution.requestId,
        });
        await dependencies.store.markEventProcessed({
          eventId: event.eventId,
          processedAt: projectedAt,
        });
        processed += 1;
      } catch (error) {
        const nextAttemptCount = event.attemptCount + 1;
        const terminalFailure = nextAttemptCount >= MAX_PROJECTION_ATTEMPTS;
        await dependencies.store.markEventFailed({
          attemptCount: nextAttemptCount,
          availableAt: terminalFailure
            ? projectedAt
            : new Date(now().valueOf() + computeRetryDelayMs(nextAttemptCount)).toISOString(),
          eventId: event.eventId,
          lastError:
            error instanceof Error
              ? error.message
              : "Unexpected projection materialization failure.",
          processedAt: terminalFailure ? projectedAt : null,
        });
        failed += 1;
      }
    }

    return { failed, processed };
  }

  return {
    async drain(input) {
      const limit = input?.limit && input.limit > 0 ? Math.floor(input.limit) : DEFAULT_DRAIN_LIMIT;
      const events = await dependencies.store.listPendingEvents(limit, now());
      return materializeEvents(events);
    },

    async drainRequest(requestId) {
      const events = dependencies.store.listPendingEventsForRequest
        ? await dependencies.store.listPendingEventsForRequest(requestId, now())
        : (await dependencies.store.listPendingEvents(DEFAULT_DRAIN_LIMIT, now())).filter(
            (event) => event.requestId === requestId,
          );

      return materializeEvents(events);
    },
  };
}
