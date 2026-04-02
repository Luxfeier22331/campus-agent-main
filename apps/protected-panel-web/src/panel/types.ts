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
  siteId: string;
  startedAt: string;
  status: string;
  summary: Record<string, unknown> | null;
}

export interface OfficialWebRunRecord extends RawOfficialWebRunRecord {
  id: string;
}

export interface RawOfficialWebRunListResponse {
  page: {
    nextCursor: string | null;
  };
  runs: RawOfficialWebRunRecord[];
}

export interface RawOfficialWebRunDetailResponse {
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
  recentRuns?: OfficialWebRunRecord[];
}

export interface RawOfficialWebSiteListResponse {
  sites: RawOfficialWebSiteRecord[];
}

export interface RawOfficialWebSiteDetailResponse {
  recentRuns: RawOfficialWebRunRecord[];
  site: RawOfficialWebSiteRecord;
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
    recentRuns: input.recentRuns.map(normalizeOfficialWebRunRecord),
  };
}
