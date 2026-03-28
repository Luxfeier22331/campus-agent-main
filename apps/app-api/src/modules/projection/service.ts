import type { RequestExecutionStatus } from "../runtime-command";

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
  requestId: string;
  traceId: string;
  surface: string;
  conversationId: string;
  actorUserId: string;
  actorSnapshot: Record<string, unknown>;
  requestedCapability: string | null;
  requestedScope: Record<string, unknown> | null;
  selectedTarget: string | null;
  status: RequestExecutionStatus;
  errorCode: string | null;
  questionPreview: string;
  answerPreview: string | null;
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
  requestedCapability: string | null;
  requestedScope: Record<string, unknown> | null;
  selectedTarget: string | null;
  status: RequestExecutionStatus;
  errorCode: string | null;
  questionPreview: string;
  answerPreview: string | null;
  sourceDocIds: string[];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  projectedAt: string;
}

export interface RequestProjectionProjectorStore {
  getRequestExecution(requestId: string): Promise<RequestExecutionProjectionSource | null>;
  listPendingEvents(limit: number, now: Date): Promise<ProjectionOutboxEvent[]>;
  markEventFailed(input: {
    eventId: string;
    attemptCount: number;
    lastError: string;
  }): Promise<void>;
  markEventProcessed(input: { eventId: string; processedAt: string }): Promise<void>;
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

function normalizePrincipalType(snapshot: Record<string, unknown>): string {
  const value = snapshot.principal_type;
  return typeof value === "string" && value.trim() ? value : "unknown";
}

function normalizePrincipalLabel(snapshot: Record<string, unknown>): string | null {
  const displayName = snapshot.display_name;
  if (typeof displayName === "string" && displayName.trim()) {
    return displayName;
  }

  const email = snapshot.email;
  return typeof email === "string" && email.trim() ? email : null;
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
    principalId: input.execution.actorUserId,
    principalLabel: normalizePrincipalLabel(input.execution.actorSnapshot),
    principalType: normalizePrincipalType(input.execution.actorSnapshot),
    projectedAt: input.projectedAt,
    questionPreview: input.execution.questionPreview,
    requestId: input.execution.requestId,
    requestedCapability: input.execution.requestedCapability,
    requestedScope: input.execution.requestedScope,
    selectedTarget: input.execution.selectedTarget,
    sourceDocIds: input.execution.sourceDocIds,
    startedAt: input.execution.startedAt,
    status: input.execution.status,
    surface: input.execution.surface,
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
          await dependencies.store.markEventProcessed({
            eventId: event.eventId,
            processedAt: projectedAt,
          });
          processed += 1;
        } catch (error) {
          await dependencies.store.markEventFailed({
            attemptCount: event.attemptCount + 1,
            eventId: event.eventId,
            lastError:
              error instanceof Error ? error.message : "Unexpected projection materialization failure.",
          });
          failed += 1;
        }
      }

      return { failed, processed };
    },
  };
}
