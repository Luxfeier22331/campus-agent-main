import { createHash } from "node:crypto";

import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../../config";
import type { RequestedScope } from "../integration";
import {
  createAxiomRuntimeEventSink,
  type AxiomRuntimeEventSink,
} from "./axiom";
import {
  resolveTracePropagationHeaders,
  type TracePropagationHeaders,
} from "./trace";

export type { TracePropagationHeaders } from "./trace";
export {
  createAxiomRuntimeEventSink,
  sanitizeAxiomEventPayload,
  type AxiomRuntimeEventSink,
} from "./axiom";

interface ActorTelemetrySummary {
  principalType: string | null;
  subject: string | null;
}

interface BaseRequestTelemetry {
  conversationId: string;
  requestId: string;
  requestedCapability: string;
  requestedScope: RequestedScope;
  surface: string;
  traceId: string;
}

export interface AppTelemetry {
  captureException(
    error: unknown,
    input?: {
      route?: string;
      status?: number;
      surface?: string;
      traceId?: string | null;
    },
  ): void;
  configureChatRequestScope(
    input: BaseRequestTelemetry & {
      actor: ActorTelemetrySummary;
    },
  ): void;
  configureHttpRequestScope(input: {
    route: string;
    surface: string;
    traceId?: string | null;
  }): void;
  getTraceHeaders(input?: { request?: Request | Headers | null }): TracePropagationHeaders;
  markHttpResponseStatus(status: number): void;
  recordProjectionDrain(input: {
    abandoned?: number;
    failed: number;
    processed: number;
    projector: string;
    projectorLastErrorCode?: string | null;
    surface: string;
  }): Promise<void>;
  recordProjectionEnqueued(
    input: BaseRequestTelemetry & {
      projectionStage: "accepted" | "finalized";
    },
  ): Promise<void>;
  recordRequestAccepted(
    input: BaseRequestTelemetry & {
      actor: ActorTelemetrySummary;
      status: "accepted";
    },
  ): Promise<void>;
  recordRequestFinalized(
    input: BaseRequestTelemetry & {
      durationMs: number;
      errorCode: string | null;
      retryable: boolean | null;
      selectedTarget: string | null;
      sourceDocIds: string[];
      status: "completed" | "error" | "needs_clarification" | "no_answer";
    },
  ): Promise<void>;
  recordRequestTransportError(
    input: BaseRequestTelemetry & {
      errorCode: string;
      retryable: boolean;
    },
  ): Promise<void>;
}

function hashIdentifier(value: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function toRequestedScopeSummary(scope: RequestedScope): string {
  return `${scope.corpus}/${scope.collection}`;
}

function toSourceDocIdsSummary(sourceDocIds: string[]): string | null {
  if (sourceDocIds.length === 0) {
    return null;
  }

  return sourceDocIds.slice(0, 3).join(",");
}

function applyRequestTags(input: {
  requestedCapability?: string | null;
  requestedScope?: RequestedScope | null;
  requestId?: string | null;
  route?: string | null;
  selectedTarget?: string | null;
  status?: string | null;
  surface?: string | null;
  traceId?: string | null;
}): void {
  if (input.requestId) {
    Sentry.setTag("request_id", input.requestId);
  }
  if (input.traceId) {
    Sentry.setTag("trace_id", input.traceId);
  }
  if (input.surface) {
    Sentry.setTag("surface", input.surface);
  }
  if (input.route) {
    Sentry.setTag("route", input.route);
  }
  if (input.status) {
    Sentry.setTag("status", input.status);
  }
  if (input.selectedTarget) {
    Sentry.setTag("selected_target", input.selectedTarget);
  }
  if (input.requestedCapability) {
    Sentry.setTag("requested_capability", input.requestedCapability);
  }
  if (input.requestedScope) {
    Sentry.setTag("requested_scope", toRequestedScopeSummary(input.requestedScope));
  }
}

export function createAppTelemetry(
  env: Pick<
    Env,
    | "AXIOM_DATASET"
    | "AXIOM_ENDPOINT"
    | "AXIOM_TOKEN"
  >,
  input: {
    axiomSink?: AxiomRuntimeEventSink;
    traceDataProvider?: () => Record<string, unknown>;
  } = {},
): AppTelemetry {
  const axiomSink = input.axiomSink ?? createAxiomRuntimeEventSink(env);
  const traceDataProvider = input.traceDataProvider ?? (() => Sentry.getTraceData());

  return {
    captureException(error, detail) {
      Sentry.withScope((scope) => {
        if (detail?.route) {
          scope.setTag("route", detail.route);
        }
        if (detail?.status) {
          scope.setTag("status", String(detail.status));
        }
        if (detail?.surface) {
          scope.setTag("surface", detail.surface);
        }
        if (detail?.traceId) {
          scope.setTag("trace_id", detail.traceId);
        }

        Sentry.captureException(error);
      });
    },

    configureChatRequestScope(input) {
      applyRequestTags({
        requestId: input.requestId,
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
        status: "accepted",
        surface: input.surface,
        traceId: input.traceId,
      });
      Sentry.setContext("actor", {
        actor_id_hash: hashIdentifier(input.actor.subject),
        principal_type: input.actor.principalType,
      });
    },

    configureHttpRequestScope(input) {
      applyRequestTags({
        route: input.route,
        surface: input.surface,
        traceId: input.traceId,
      });
    },

    getTraceHeaders(input) {
      return resolveTracePropagationHeaders({
        request: input?.request,
        traceData: traceDataProvider(),
      });
    },

    markHttpResponseStatus(status) {
      Sentry.setTag("status", String(status));
    },

    async recordProjectionDrain(input) {
      await axiomSink.emit({
        abandoned_count: input.abandoned ?? 0,
        event_type: "projection.drain",
        failed_count: input.failed,
        processed_count: input.processed,
        projector_last_error_code: input.projectorLastErrorCode ?? null,
        projector_name: input.projector,
        surface: input.surface,
      });
    },

    async recordProjectionEnqueued(input) {
      await axiomSink.emit({
        conversation_id: input.conversationId,
        event_type: "projection.enqueued",
        projection_stage: input.projectionStage,
        request_id: input.requestId,
        requested_capability: input.requestedCapability,
        requested_scope_summary: toRequestedScopeSummary(input.requestedScope),
        surface: input.surface,
        trace_id: input.traceId,
      });
    },

    async recordRequestAccepted(input) {
      applyRequestTags({
        requestId: input.requestId,
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
        status: input.status,
        surface: input.surface,
        traceId: input.traceId,
      });

      await axiomSink.emit({
        actor_id_hash: hashIdentifier(input.actor.subject),
        actor_principal_type: input.actor.principalType,
        conversation_id: input.conversationId,
        event_type: "request.accepted",
        request_id: input.requestId,
        requested_capability: input.requestedCapability,
        requested_scope_summary: toRequestedScopeSummary(input.requestedScope),
        status: input.status,
        surface: input.surface,
        trace_id: input.traceId,
      });
    },

    async recordRequestFinalized(input) {
      applyRequestTags({
        requestId: input.requestId,
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
        selectedTarget: input.selectedTarget,
        status: input.status,
        surface: input.surface,
        traceId: input.traceId,
      });

      await axiomSink.emit({
        conversation_id: input.conversationId,
        duration_ms: input.durationMs,
        error_code: input.errorCode,
        event_type: "request.finalized",
        request_id: input.requestId,
        requested_capability: input.requestedCapability,
        requested_scope_summary: toRequestedScopeSummary(input.requestedScope),
        retryable: input.retryable,
        selected_target: input.selectedTarget,
        source_doc_ids_count: input.sourceDocIds.length,
        source_doc_ids_summary: toSourceDocIdsSummary(input.sourceDocIds),
        status: input.status,
        surface: input.surface,
        trace_id: input.traceId,
      });
    },

    async recordRequestTransportError(input) {
      applyRequestTags({
        requestId: input.requestId,
        requestedCapability: input.requestedCapability,
        requestedScope: input.requestedScope,
        status: "error",
        surface: input.surface,
        traceId: input.traceId,
      });

      await axiomSink.emit({
        conversation_id: input.conversationId,
        error_code: input.errorCode,
        event_type: "request.transport_error",
        request_id: input.requestId,
        requested_capability: input.requestedCapability,
        requested_scope_summary: toRequestedScopeSummary(input.requestedScope),
        retryable: input.retryable,
        status: "error",
        surface: input.surface,
        trace_id: input.traceId,
      });
    },
  };
}
