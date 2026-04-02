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
  policyProjectionVersion: string | null;
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

export interface RequestProjectionProjectorStore {
  getRequestExecution(requestId: string): Promise<RequestExecutionProjectionSource | null>;
  listPendingEvents(limit: number, now: Date): Promise<ProjectionOutboxEvent[]>;
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
  upsertAuditProjection(projection: RequestAuditProjectionMaterialization): Promise<void>;
  upsertProjection(projection: RequestProjectionMaterialization): Promise<void>;
}

export interface RequestProjectionProjector {
  drain(input?: { limit?: number }): Promise<{ processed: number; failed: number }>;
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

  return {
    async drain(input) {
      const limit = input?.limit && input.limit > 0 ? Math.floor(input.limit) : DEFAULT_DRAIN_LIMIT;
      const events = await dependencies.store.listPendingEvents(limit, now());
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
    },
  };
}
