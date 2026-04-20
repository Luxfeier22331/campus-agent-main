export interface RawRequestProjectionRecord {
  answerPreview: string | null;
  applicabilityScope: string | null;
  completedAt: string | null;
  conversationId: string;
  diagnostics?: RequestProjectionDiagnostics;
  durationMs: number | null;
  errorCode: string | null;
  entitlementGroups: string[];
  entitlementSnapshotId: string | null;
  principalId: string;
  principalLabel: string | null;
  principalType: string;
  projectedAt: string;
  questionPreview: string;
  requestId: string;
  requestedCapability: string | null;
  requestedScope: Record<string, unknown> | null;
  resolvedScope: Record<string, unknown> | null;
  selectedTarget: string | null;
  sourceDocIds: string[];
  startedAt: string;
  status: string;
  surface: string;
  traceId: string;
  visibilityScope: string | null;
}

export interface RequestProjectionDiagnostics {
  clarificationReason: string | null;
  noAnswerReason: string | null;
  resolvedPolicyDocumentId: string | null;
  resolvedPolicyTitle: string | null;
  retrievedTitleSummary: string[];
  rewrittenQuery: string | null;
}

export interface RequestProjectionRecord extends RawRequestProjectionRecord {
  id: string;
}

export interface RawRequestListResponse {
  page: {
    nextCursor: string | null;
  };
  requests: RawRequestProjectionRecord[];
}

export interface RawRequestDetailResponse {
  request: RawRequestProjectionRecord;
}

export interface RawRequestObservabilityRecord {
  request: {
    completedAt: string | null;
    conversationId: string;
    requestId: string;
    requestedCapability: string | null;
    requestedScope: Record<string, unknown> | null;
    selectedTarget: string | null;
    startedAt: string;
    status: string;
    surface: string;
    traceId: string;
  };
  observability: {
    aclAnomalyCode: string | null;
    aclDecision: string | null;
    cachedInputTokens: number | null;
    candidateCount: number | null;
    citationCount: number | null;
    citationExpected: boolean | null;
    citationMissing: boolean | null;
    durationMs: number | null;
    emptyRecall: boolean | null;
    estimatedCost: {
      currency: "USD";
      microusd: number | null;
    };
    failClosed: boolean | null;
    inputTokens: number | null;
    measuredAt: string | null;
    model: {
      name: string | null;
      provider: string | null;
    };
    outputTokens: number | null;
    projectionLagMs: number | null;
    refusalClass: string | null;
    retrievedSourceCount: number | null;
    retrievalAttempted: boolean | null;
    traceAvailable: boolean;
  };
  links: {
    issueFingerprint: string | null;
    issueLink: string | null;
    traceLink: string | null;
  };
  auditSummary: {
    auditEventCount: number;
    latestTerminalCode: string | null;
  };
}

export type RequestObservabilityRecord = RawRequestObservabilityRecord;

export function normalizeRequestRecord(
  input: RawRequestProjectionRecord,
): RequestProjectionRecord {
  return {
    ...input,
    id: input.requestId,
  };
}
