import type { RequestedScope } from "../integration";
import type { TracePropagationHeaders } from "./trace";

export interface ActorTelemetrySummary {
  principalType: string | null;
  subject: string | null;
}

export interface BaseRequestTelemetry {
  conversationId: string;
  principalType?: string | null;
  requestId: string;
  requestedCapability: string;
  requestedScope?: RequestedScope | null;
  resolvedScope?: RequestedScope | null;
  safetyIdentifier?: string | null;
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
      status:
        | "completed"
        | "error"
        | "needs_clarification"
        | "no_answer"
        | "approval_required"
        | "rejected";
    },
  ): Promise<void>;
  recordRequestTransportError(
    input: BaseRequestTelemetry & {
      errorCode: string;
      retryable: boolean;
    },
  ): Promise<void>;
  recordQualitySampledGrade(input: {
    collection: string | null;
    gradeDomain: "grounding" | "citation" | "policy";
    gradeId: string;
    gradeSource: string;
    graderVersion: string;
    modelName: string | null;
    principalType: string;
    rationaleSummary: string | null;
    requestId: string;
    requestStartedAt: string;
    requestedCapability: string | null;
    requestedScopeSummary: string | null;
    sampledAt: string;
    scoreMilli: number | null;
    selectedTarget: string | null;
    surface: string;
    traceId: string;
    verdict: "pass" | "fail" | "needs_review";
  }): Promise<void>;
}
