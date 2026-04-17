import type { OfficialWebDiscoveryMethod, OfficialWebRunIntent } from "./config.ts";
import type { OfficialWebUrlIdentityBasis } from "./policy.ts";
import type { OfficialWebPageFamily, OfficialWebPageSignalSummary } from "./source-truth.ts";

export const OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS = [
  "crawl-run.json",
  "host-summary.json",
  "url-results.jsonl",
  "failures.jsonl",
] as const;
export const OFFICIAL_WEB_OPTIONAL_RUN_ARTIFACTS = [
  "source-truth-bundle.json",
  "quality-audit.json",
  "page-observations.jsonl",
  "dynamic-shell-discovery-audit.jsonl",
] as const;
export const OFFICIAL_WEB_RUN_ARTIFACT_TYPE_BY_NAME = {
  "crawl-run.json": "crawl_run_manifest",
  "host-summary.json": "host_summary",
  "url-results.jsonl": "url_results",
  "failures.jsonl": "failures",
  "source-truth-bundle.json": "source_truth_bundle",
  "quality-audit.json": "quality_audit",
  "page-observations.jsonl": "page_observations",
  "dynamic-shell-discovery-audit.jsonl": "dynamic_shell_discovery_audit",
} as const;
export const OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT = "quality-audit.json" as const;
export const OFFICIAL_WEB_PAGE_OBSERVATIONS_ARTIFACT = "page-observations.jsonl" as const;
export const OFFICIAL_WEB_DYNAMIC_SHELL_DISCOVERY_AUDIT_ARTIFACT =
  "dynamic-shell-discovery-audit.jsonl" as const;
export const OFFICIAL_WEB_QUALITY_AUDIT_STATUSES = ["pass", "review", "fail"] as const;

export type OfficialWebRunArtifactName = (typeof OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS)[number];
export type OfficialWebAdditionalRunArtifactName =
  (typeof OFFICIAL_WEB_OPTIONAL_RUN_ARTIFACTS)[number];
export type OfficialWebKnownRunArtifactName =
  | OfficialWebRunArtifactName
  | OfficialWebAdditionalRunArtifactName;
export type OfficialWebRunArtifactType =
  (typeof OFFICIAL_WEB_RUN_ARTIFACT_TYPE_BY_NAME)[keyof typeof OFFICIAL_WEB_RUN_ARTIFACT_TYPE_BY_NAME];
export type OfficialWebQualityAuditStatus = (typeof OFFICIAL_WEB_QUALITY_AUDIT_STATUSES)[number];
export type OfficialWebPageObservationDisposition =
  | "fetched"
  | "not_modified"
  | "deleted"
  | "fetch_failed";
export type OfficialWebCrawlRunStatus =
  | "accepted"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "abandoned";
export type OfficialWebUrlResultOutcome =
  | "fetched"
  | "not_modified"
  | "deleted"
  | "unsupported_content_type"
  | "robots_blocked"
  | "admission_rejected"
  | "http_error"
  | "request_failed";
export type OfficialWebFailurePhase = "robots" | "sitemap" | "fetch" | "process" | "queue";

export interface OfficialWebUrlResultRecord {
  schemaVersion: "official_web_url_result.v1";
  observedAt: string;
  siteId: string;
  crawlRunId: string;
  requestedUrl: string;
  finalUrl: string | null;
  declaredCanonicalUrl: string | null;
  normalizedCanonicalUrl: string | null;
  urlIdentityBasis: OfficialWebUrlIdentityBasis | null;
  discoveryMethod: OfficialWebDiscoveryMethod;
  discoveredFromUrl: string | null;
  host: string;
  depth: number;
  httpStatus: number | null;
  contentType: string | null;
  outcome: OfficialWebUrlResultOutcome;
}

export interface OfficialWebFailureRecord {
  schemaVersion: "official_web_failure.v1";
  observedAt: string;
  siteId: string;
  crawlRunId: string;
  host: string | null;
  url: string;
  phase: OfficialWebFailurePhase;
  reason: string;
  message: string;
  retryable: boolean;
}

export interface OfficialWebHostSummaryRecord {
  host: string;
  pagesObserved: number;
  pagesFetched: number;
  failures: number;
  admissionRejected: number;
  robotsBlocked: boolean;
}

export interface OfficialWebHostSummaryDocument {
  schemaVersion: "official_web_host_summary.v1";
  siteId: string;
  crawlRunId: string;
  generatedAt: string;
  hosts: OfficialWebHostSummaryRecord[];
}

export interface OfficialWebCrawlRunRecord {
  schemaVersion: "official_web_crawl_run.v1";
  siteId: string;
  crawlRunId: string;
  runIntent: OfficialWebRunIntent;
  generatedAt: string;
  startedAt: string;
  finishedAt: string | null;
  status: OfficialWebCrawlRunStatus;
  requiredArtifacts: OfficialWebRunArtifactName[];
  counters: {
    urlsObserved: number;
    urlsFetched: number;
    failures: number;
    hostsPlanned: number;
    hostsCompleted: number;
  };
}

export interface OfficialWebRunArtifactRef {
  artifactType: OfficialWebRunArtifactType;
  objectKey: string;
  contentSha256: string;
  byteSize?: number;
  recordCount?: number;
}

export interface OfficialWebPageObservationRecord {
  schemaVersion: "official_web_page_observation.v1";
  observedAt: string;
  siteId: string;
  crawlRunId: string;
  runIntent: OfficialWebRunIntent;
  rawAssetId: string | null;
  rawVersionId: string | null;
  host: string;
  requestedUrl: string;
  finalUrl: string;
  normalizedCanonicalUrl: string;
  pageFamily: OfficialWebPageFamily;
  pageTitleNormalized: string;
  discoveryMethod: OfficialWebDiscoveryMethod;
  discoveredFromUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  responseBodyHash: string | null;
  mainContentHash: string | null;
  disposition: OfficialWebPageObservationDisposition;
}

export interface OfficialWebPageQualityAuditIssue {
  code: string;
  severity: Exclude<OfficialWebQualityAuditStatus, "pass">;
  message: string;
}

export interface OfficialWebPageQualityAuditEntry {
  rawAssetId: string;
  rawVersionId: string;
  host: string;
  normalizedCanonicalUrl: string;
  pageTitleNormalized: string;
  pageFamily: OfficialWebPageFamily;
  pageFamilyConfidence: number;
  pageFamilyReason: string | null;
  counts: {
    blockCount: number;
    mainContentBlockCount: number;
    navigationBlockCount: number;
    boilerplateBlockCount: number;
    discoveredLinkCount: number;
  };
  signals: OfficialWebPageSignalSummary;
  status: OfficialWebQualityAuditStatus;
  issues: OfficialWebPageQualityAuditIssue[];
}

export interface OfficialWebQualityAuditDocument {
  schemaVersion: "official_web_quality_audit.v1";
  siteId: string;
  crawlRunId: string;
  generatedAt: string;
  summary: {
    totalPages: number;
    passPages: number;
    reviewPages: number;
    failPages: number;
    familyCounts: Record<OfficialWebPageFamily, number>;
    issueCounts: Record<string, number>;
  };
  pages: OfficialWebPageQualityAuditEntry[];
}

export function buildOfficialWebUrlResultRecord(
  input: Omit<OfficialWebUrlResultRecord, "observedAt" | "schemaVersion"> & {
    observedAt?: string;
  },
): OfficialWebUrlResultRecord {
  return {
    schemaVersion: "official_web_url_result.v1",
    observedAt: input.observedAt ?? new Date().toISOString(),
    siteId: input.siteId,
    crawlRunId: input.crawlRunId,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    declaredCanonicalUrl: input.declaredCanonicalUrl,
    normalizedCanonicalUrl: input.normalizedCanonicalUrl,
    urlIdentityBasis: input.urlIdentityBasis,
    discoveryMethod: input.discoveryMethod,
    discoveredFromUrl: input.discoveredFromUrl ?? null,
    host: input.host,
    depth: input.depth,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    outcome: input.outcome,
  };
}

export function buildOfficialWebFailureRecord(
  input: Omit<OfficialWebFailureRecord, "host" | "observedAt" | "schemaVersion"> & {
    host?: string | null;
    observedAt?: string;
  },
): OfficialWebFailureRecord {
  return {
    schemaVersion: "official_web_failure.v1",
    observedAt: input.observedAt ?? new Date().toISOString(),
    siteId: input.siteId,
    crawlRunId: input.crawlRunId,
    host: input.host ?? null,
    url: input.url,
    phase: input.phase,
    reason: input.reason,
    message: input.message,
    retryable: input.retryable,
  };
}

export function buildOfficialWebHostSummaryDocument(
  input: Omit<OfficialWebHostSummaryDocument, "generatedAt" | "schemaVersion"> & {
    generatedAt?: string;
  },
): OfficialWebHostSummaryDocument {
  return {
    schemaVersion: "official_web_host_summary.v1",
    siteId: input.siteId,
    crawlRunId: input.crawlRunId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    hosts: input.hosts,
  };
}

export function buildOfficialWebCrawlRunRecord(
  input: Omit<OfficialWebCrawlRunRecord, "generatedAt" | "requiredArtifacts" | "schemaVersion"> & {
    generatedAt?: string;
    requiredArtifacts?: OfficialWebRunArtifactName[];
  },
): OfficialWebCrawlRunRecord {
  return {
    schemaVersion: "official_web_crawl_run.v1",
    siteId: input.siteId,
    crawlRunId: input.crawlRunId,
    runIntent: input.runIntent,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    status: input.status,
    requiredArtifacts: input.requiredArtifacts ?? [...OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS],
    counters: input.counters,
  };
}

export function buildOfficialWebPageObservationRecord(
  input: Omit<OfficialWebPageObservationRecord, "observedAt" | "schemaVersion"> & {
    observedAt?: string;
  },
): OfficialWebPageObservationRecord {
  return {
    schemaVersion: "official_web_page_observation.v1",
    observedAt: input.observedAt ?? new Date().toISOString(),
    siteId: input.siteId,
    crawlRunId: input.crawlRunId,
    runIntent: input.runIntent,
    rawAssetId: input.rawAssetId,
    rawVersionId: input.rawVersionId,
    host: input.host,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    normalizedCanonicalUrl: input.normalizedCanonicalUrl,
    pageFamily: input.pageFamily,
    pageTitleNormalized: input.pageTitleNormalized,
    discoveryMethod: input.discoveryMethod,
    discoveredFromUrl: input.discoveredFromUrl ?? null,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    etag: input.etag ?? null,
    lastModified: input.lastModified ?? null,
    responseBodyHash: input.responseBodyHash,
    mainContentHash: input.mainContentHash,
    disposition: input.disposition,
  };
}

export function buildOfficialWebRunArtifactKey(input: {
  siteId: string;
  crawlRunId: string;
  artifactName: OfficialWebKnownRunArtifactName;
}): string {
  return `official_web/${input.siteId}/runs/${input.crawlRunId}/${input.artifactName}`;
}

export function resolveOfficialWebRunArtifactType(
  artifactName: OfficialWebKnownRunArtifactName,
): OfficialWebRunArtifactType {
  return OFFICIAL_WEB_RUN_ARTIFACT_TYPE_BY_NAME[artifactName];
}

export function buildOfficialWebQualityAuditDocument(
  input: Omit<OfficialWebQualityAuditDocument, "generatedAt" | "schemaVersion" | "summary"> & {
    generatedAt?: string;
  },
): OfficialWebQualityAuditDocument {
  const familyCounts = input.pages.reduce<Record<OfficialWebPageFamily, number>>((result, page) => {
    result[page.pageFamily] = (result[page.pageFamily] ?? 0) + 1;
    return result;
  }, {
    article_detail: 0,
    listing_page: 0,
    directory_page: 0,
    sitemap_navigation_page: 0,
    data_table_page: 0,
    gallery_page: 0,
    contact_widget_page: 0,
    structural_shell_page: 0,
    dynamic_shell_page: 0,
    generic_content_page: 0,
  });
  const issueCounts = input.pages.reduce<Record<string, number>>((result, page) => {
    for (const issue of page.issues) {
      result[issue.code] = (result[issue.code] ?? 0) + 1;
    }
    return result;
  }, {});
  const passPages = input.pages.filter((page) => page.status === "pass").length;
  const reviewPages = input.pages.filter((page) => page.status === "review").length;
  const failPages = input.pages.filter((page) => page.status === "fail").length;

  return {
    schemaVersion: "official_web_quality_audit.v1",
    siteId: input.siteId,
    crawlRunId: input.crawlRunId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      totalPages: input.pages.length,
      passPages,
      reviewPages,
      failPages,
      familyCounts,
      issueCounts,
    },
    pages: input.pages,
  };
}
