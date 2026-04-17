export interface RawOperatorContext {
  display_name: string | null;
  email: string | null;
  groups: string[];
  operator_id: string;
  principal_class: "human";
  subject: string;
}

export interface PanelOverviewRecord {
  id: "overview";
  appName: string;
  operatorContext: OperatorContext | null;
  panelDomains: Record<string, string>;
  protectedHostname: string;
  protectionEnvelope: string;
  runtime: string;
  runtimeApiBaseUrl: string;
  status: string;
  surface: string;
}

export interface RawPanelOverviewResponse {
  app_name: string;
  operator_context?: RawOperatorContext;
  panel_domains: Record<string, string>;
  protected_hostname: string;
  protection_envelope: string;
  runtime: string;
  runtime_api_base_url: string;
  status: string;
  surface: string;
}

export interface OperatorContext {
  displayName: string | null;
  email: string | null;
  groups: string[];
  operatorId: string;
  principalClass: "human";
  subject: string;
}

export interface RawRequestProjectionRecord {
  answerPreview: string | null;
  completedAt: string | null;
  conversationId: string;
  diagnostics?: RequestProjectionDiagnostics;
  durationMs: number | null;
  errorCode: string | null;
  principalId: string;
  principalLabel: string | null;
  principalType: string;
  projectedAt: string;
  questionPreview: string;
  requestId: string;
  requestedCapability: string | null;
  requestedScope: Record<string, unknown> | null;
  selectedTarget: string | null;
  sourceDocIds: string[];
  startedAt: string;
  status: string;
  surface: string;
  traceId: string;
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

export interface RawOfficialWebArtifactRecord {
  artifactType: string;
  byteSize: number | null;
  contentSha256: string;
  objectKey: string;
  recordCount: number | null;
}

export type OfficialWebArtifactRecord = RawOfficialWebArtifactRecord;

export interface RawOfficialWebRunRecord {
  artifacts: RawOfficialWebArtifactRecord[];
  collectorVersion: string | null;
  configVersion: string | null;
  failureCount: number;
  finishedAt: string | null;
  ingestionDispatchRef: string | null;
  ingestionDispatchStatus: string;
  lastHeartbeatAt: string | null;
  projectedAt: string;
  runId: string;
  runIntent: "baseline" | "hot" | "repair";
  siteId: string;
  startedAt: string;
  status: string;
  summary: Record<string, unknown> | null;
}

export interface RawOfficialWebPageChangeRecord {
  changeStatus: string;
  fetchDisposition: string;
  host: string;
  httpStatus: number | null;
  id: string;
  lastChangeReason: string;
  normalizedCanonicalUrl: string;
  observedAt: string;
  pageFamily: string;
  pageTitleNormalized: string;
  rawAssetId: string | null;
  rawVersionId: string | null;
  runId: string;
}

export interface OfficialWebPageChangeRecord extends RawOfficialWebPageChangeRecord {}

export interface RawOfficialWebSiteFreshnessSummary {
  changedLast24h: number;
  deletedPages: number;
  duePages: number;
  failedFetchPages: number;
  hotPages: number;
  repairPages: number;
  totalPages: number;
}

export interface OfficialWebSiteFreshnessSummary extends RawOfficialWebSiteFreshnessSummary {}

export interface RawOfficialWebFreshnessPageRecord {
  cadenceClass: string;
  host: string;
  lastChangeReason: string;
  lastChangedAt: string | null;
  lastFetchDisposition: string;
  lastHttpStatus: number | null;
  lastSeenAt: string;
  nextEligibleFetchAt: string;
  normalizedCanonicalUrl: string;
  pageFamily: string;
  pageTitleNormalized: string;
  priorityScore: number;
  siteId: string;
}

export interface OfficialWebFreshnessPageRecord extends RawOfficialWebFreshnessPageRecord {}

export interface RawOfficialWebSiteFreshnessBacklog {
  deletedPages: RawOfficialWebFreshnessPageRecord[];
  duePages: RawOfficialWebFreshnessPageRecord[];
  failedFetchPages: RawOfficialWebFreshnessPageRecord[];
  hotPages: RawOfficialWebFreshnessPageRecord[];
}

export interface OfficialWebSiteFreshnessBacklog {
  deletedPages: OfficialWebFreshnessPageRecord[];
  duePages: OfficialWebFreshnessPageRecord[];
  failedFetchPages: OfficialWebFreshnessPageRecord[];
  hotPages: OfficialWebFreshnessPageRecord[];
}

export interface OfficialWebRunRecord extends RawOfficialWebRunRecord {
  id: string;
  pageChangeSummary?: Record<string, number>;
  pageChanges?: OfficialWebPageChangeRecord[];
}

export interface RawOfficialWebRunListResponse {
  page: {
    nextCursor: string | null;
  };
  runs: RawOfficialWebRunRecord[];
}

export interface RawOfficialWebRunDetailResponse {
  pageChangeSummary: Record<string, number>;
  pageChanges: RawOfficialWebPageChangeRecord[];
  run: RawOfficialWebRunRecord;
}

export interface RawOfficialWebSiteRecord {
  displayName: string;
  hostRoots: string[];
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  latestCollectorVersion: string | null;
  latestConfigVersion: string | null;
  latestIngestionDispatchStatus: string | null;
  latestRunId: string | null;
  latestRunStatus: string | null;
  projectedAt: string;
  siteId: string;
}

export interface OfficialWebSiteRecord extends RawOfficialWebSiteRecord {
  id: string;
  freshnessBacklog?: OfficialWebSiteFreshnessBacklog;
  freshnessSummary?: OfficialWebSiteFreshnessSummary;
  recentPageChanges?: OfficialWebPageChangeRecord[];
  recentRuns?: OfficialWebRunRecord[];
}

export interface RawOfficialWebSiteListResponse {
  sites: RawOfficialWebSiteRecord[];
}

export interface RawOfficialWebSiteDetailResponse {
  freshnessBacklog: RawOfficialWebSiteFreshnessBacklog;
  freshnessSummary: RawOfficialWebSiteFreshnessSummary;
  recentPageChanges: RawOfficialWebPageChangeRecord[];
  recentRuns: RawOfficialWebRunRecord[];
  site: RawOfficialWebSiteRecord;
}

export function normalizeOfficialWebPageChangeRecord(
  input: RawOfficialWebPageChangeRecord,
): OfficialWebPageChangeRecord {
  return {
    ...input,
  };
}

export function normalizeOfficialWebFreshnessPageRecord(
  input: RawOfficialWebFreshnessPageRecord,
): OfficialWebFreshnessPageRecord {
  return {
    ...input,
  };
}

export function normalizeOfficialWebSiteFreshnessBacklog(
  input: RawOfficialWebSiteFreshnessBacklog,
): OfficialWebSiteFreshnessBacklog {
  return {
    deletedPages: input.deletedPages.map(normalizeOfficialWebFreshnessPageRecord),
    duePages: input.duePages.map(normalizeOfficialWebFreshnessPageRecord),
    failedFetchPages: input.failedFetchPages.map(normalizeOfficialWebFreshnessPageRecord),
    hotPages: input.hotPages.map(normalizeOfficialWebFreshnessPageRecord),
  };
}

export function normalizeOperatorContext(
  input: RawOperatorContext | undefined,
): OperatorContext | null {
  if (!input) {
    return null;
  }

  return {
    displayName: input.display_name,
    email: input.email,
    groups: input.groups,
    operatorId: input.operator_id,
    principalClass: input.principal_class,
    subject: input.subject,
  };
}

export function normalizeOverviewRecord(
  input: RawPanelOverviewResponse,
): PanelOverviewRecord {
  return {
    appName: input.app_name,
    id: "overview",
    operatorContext: normalizeOperatorContext(input.operator_context),
    panelDomains: input.panel_domains,
    protectedHostname: input.protected_hostname,
    protectionEnvelope: input.protection_envelope,
    runtime: input.runtime,
    runtimeApiBaseUrl: input.runtime_api_base_url,
    status: input.status,
    surface: input.surface,
  };
}

export function normalizeRequestRecord(
  input: RawRequestProjectionRecord,
): RequestProjectionRecord {
  return {
    ...input,
    id: input.requestId,
  };
}

export function normalizeOfficialWebRunRecord(
  input: RawOfficialWebRunRecord,
): OfficialWebRunRecord {
  return {
    ...input,
    id: input.runId,
  };
}

export function normalizeOfficialWebSiteRecord(
  input: RawOfficialWebSiteRecord,
): OfficialWebSiteRecord {
  return {
    ...input,
    id: input.siteId,
  };
}

export function normalizeOfficialWebSiteDetailRecord(
  input: RawOfficialWebSiteDetailResponse,
): OfficialWebSiteRecord {
  return {
    ...normalizeOfficialWebSiteRecord(input.site),
    freshnessBacklog: normalizeOfficialWebSiteFreshnessBacklog(input.freshnessBacklog),
    freshnessSummary: input.freshnessSummary,
    recentPageChanges: input.recentPageChanges.map(normalizeOfficialWebPageChangeRecord),
    recentRuns: input.recentRuns.map(normalizeOfficialWebRunRecord),
  };
}

export function normalizeOfficialWebRunDetailRecord(
  input: RawOfficialWebRunDetailResponse,
): OfficialWebRunRecord {
  return {
    ...normalizeOfficialWebRunRecord(input.run),
    pageChangeSummary: input.pageChangeSummary,
    pageChanges: input.pageChanges.map(normalizeOfficialWebPageChangeRecord),
  };
}
