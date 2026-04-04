import type { ResolvedAppPrincipal } from "./auth";
import type { RequestedScope, SupervisorExecutionResponse } from "./integration";
import type { RequestDiagnosticsSummary } from "./request-diagnostics";
import type { RequestExecutionStatus, RequestObservabilityFactWrite } from "./runtime-command/store";

function toScopeSummary(scope: RequestedScope | null | undefined): string | null {
  if (!scope?.corpus || !scope?.collection) {
    return null;
  }

  return `${scope.corpus}/${scope.collection}`;
}

function normalizeAclDecision(input: {
  diagnostics: RequestDiagnosticsSummary | null;
  response: SupervisorExecutionResponse;
  status: RequestExecutionStatus;
}): string | null {
  if (input.response.observability?.aclDecision) {
    return input.response.observability.aclDecision;
  }
  if (input.status === "approval_required") {
    return "approval_required";
  }
  if (input.status === "rejected") {
    return "denied";
  }
  if (input.diagnostics?.noAnswerReason === "restricted_access_denied") {
    return "denied";
  }

  return input.status === "accepted" ? null : "allowed";
}

function normalizeFailClosed(input: {
  diagnostics: RequestDiagnosticsSummary | null;
  response: SupervisorExecutionResponse;
  status: RequestExecutionStatus;
}): boolean | null {
  if (typeof input.response.observability?.failClosed === "boolean") {
    return input.response.observability.failClosed;
  }
  if (input.status === "accepted") {
    return null;
  }
  if (input.status === "approval_required" || input.status === "rejected") {
    return true;
  }
  if (input.diagnostics?.noAnswerReason === "restricted_access_denied") {
    return true;
  }

  return false;
}

function normalizeRefusalClass(
  response: SupervisorExecutionResponse,
  status: RequestExecutionStatus,
): string | null {
  if (response.observability?.refusalClass) {
    return response.observability.refusalClass;
  }
  if (
    status === "needs_clarification" ||
    status === "no_answer" ||
    status === "approval_required" ||
    status === "rejected"
  ) {
    return status;
  }

  return null;
}

export function buildAcceptedRequestObservabilityFact(input: {
  conversationId: string;
  principal: ResolvedAppPrincipal;
  requestId: string;
  requestedCapability: string | null;
  requestedScope: RequestedScope | null;
  resolvedScope: RequestedScope | null;
  surface: string;
  startedAt: string;
  traceId: string;
}): RequestObservabilityFactWrite {
  return {
    aclAnomalyCode: null,
    aclDecision: null,
    cachedInputTokens: null,
    candidateCount: null,
    citationCount: null,
    citationExpected: null,
    citationMissing: null,
    collection: input.resolvedScope?.collection ?? null,
    completedAt: null,
    conversationId: input.conversationId,
    durationMs: null,
    emptyRecall: null,
    entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
    errorCode: null,
    estimatedCostMicrousd: null,
    failClosed: null,
    inputTokens: null,
    measuredAt: input.startedAt,
    modelName: null,
    modelProvider: null,
    outputTokens: null,
    policyProjectionVersion:
      input.principal.authorization?.retrievalFilter.policyProjectionVersion ?? null,
    principalType: input.principal.principal.type,
    projectionLagMs: null,
    requestId: input.requestId,
    requestedCapability: input.requestedCapability,
    requestedScopeSummary: toScopeSummary(input.requestedScope),
    resolvedScopeSummary: toScopeSummary(input.resolvedScope),
    refusalClass: null,
    retrievedSourceCount: null,
    retrievalAttempted: null,
    selectedTarget: null,
    startedAt: input.startedAt,
    status: "accepted",
    surface: input.surface,
    traceAvailable: Boolean(input.traceId),
    traceId: input.traceId,
    updatedAt: input.startedAt,
  };
}

export function buildFinalizedRequestObservabilityFact(input: {
  completedAt: string;
  diagnostics: RequestDiagnosticsSummary | null;
  durationMs: number;
  errorCode: string | null;
  principal: ResolvedAppPrincipal;
  requestId: string;
  requestedCapability: string | null;
  requestedScope: RequestedScope | null;
  resolvedScope: RequestedScope | null;
  response: SupervisorExecutionResponse;
  sourceDocIds: string[];
  startedAt: string;
  status: RequestExecutionStatus;
  surface: string;
  traceId: string;
  conversationId: string;
}): RequestObservabilityFactWrite {
  const observability = input.response.observability;
  const retrievedSourceCount = observability?.retrievedSourceCount ?? input.sourceDocIds.length;
  const citationCount = observability?.citationCount ?? input.sourceDocIds.length;
  const retrievalAttempted =
    typeof observability?.retrievalAttempted === "boolean"
      ? observability.retrievalAttempted
      : null;
  const citationExpected =
    typeof observability?.citationExpected === "boolean"
      ? observability.citationExpected
      : null;

  return {
    aclAnomalyCode: observability?.aclAnomalyCode ?? null,
    aclDecision: normalizeAclDecision({
      diagnostics: input.diagnostics,
      response: input.response,
      status: input.status,
    }),
    cachedInputTokens: observability?.cachedInputTokens ?? null,
    candidateCount: observability?.candidateCount ?? null,
    citationCount,
    citationExpected,
    citationMissing:
      typeof observability?.citationMissing === "boolean"
        ? observability.citationMissing
        : citationExpected === true
          ? citationCount === 0
          : null,
    collection: input.resolvedScope?.collection ?? null,
    completedAt: input.completedAt,
    conversationId: input.conversationId,
    durationMs: input.durationMs,
    emptyRecall:
      retrievalAttempted === true ? retrievedSourceCount === 0 : null,
    entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
    errorCode: input.errorCode,
    estimatedCostMicrousd: observability?.estimatedCostMicrousd ?? null,
    failClosed: normalizeFailClosed({
      diagnostics: input.diagnostics,
      response: input.response,
      status: input.status,
    }),
    inputTokens: observability?.inputTokens ?? null,
    measuredAt: input.completedAt,
    modelName: observability?.modelName ?? null,
    modelProvider: observability?.modelProvider ?? null,
    outputTokens: observability?.outputTokens ?? null,
    policyProjectionVersion:
      input.principal.authorization?.retrievalFilter.policyProjectionVersion ?? null,
    principalType: input.principal.principal.type,
    projectionLagMs: null,
    requestId: input.requestId,
    requestedCapability: input.requestedCapability,
    requestedScopeSummary: toScopeSummary(input.requestedScope),
    resolvedScopeSummary: toScopeSummary(input.resolvedScope),
    refusalClass: normalizeRefusalClass(input.response, input.status),
    retrievedSourceCount,
    retrievalAttempted,
    selectedTarget: input.response.selectedTarget,
    startedAt: input.startedAt,
    status: input.status,
    surface: input.surface,
    traceAvailable: Boolean(input.traceId),
    traceId: input.traceId,
    updatedAt: input.completedAt,
  };
}

export function summarizeRequestedScope(scope: RequestedScope | null | undefined): string | null {
  return toScopeSummary(scope);
}
