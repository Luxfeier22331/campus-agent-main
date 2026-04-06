import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { OfficialWebCollectorPrincipal } from "../auth";
import type {
  AppendOfficialWebHeartbeatWrite,
  FinalizeOfficialWebRunWrite,
  OfficialWebArtifactRecord,
  OfficialWebCommandStore,
  OfficialWebFetchDisposition,
  OfficialWebPageChange,
  OfficialWebPageChangeStatus,
  OfficialWebRunIntent,
  OfficialWebRunStatus,
  OfficialWebTerminalRunStatus,
  PersistedOfficialWebPageObservation,
  StoredOfficialWebPageFreshnessState,
  StoredOfficialWebRun,
} from "./store";

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 60;
const TERMINAL_STATUSES = new Set<OfficialWebRunStatus>([
  "completed",
  "completed_with_errors",
  "failed",
  "abandoned",
]);
const FINALIZEABLE_TERMINAL_STATUSES = new Set<OfficialWebTerminalRunStatus>([
  "completed",
  "completed_with_errors",
  "failed",
]);
const ALLOWED_ARTIFACT_TYPES = new Set([
  "crawl_run_manifest",
  "host_summary",
  "url_results",
  "failures",
  "source_truth_bundle",
  "quality_audit",
  "page_observations",
]);
const ALLOWED_RUN_INTENTS = new Set<OfficialWebRunIntent>(["baseline", "hot", "repair"]);
const ALLOWED_FETCH_DISPOSITIONS = new Set<OfficialWebFetchDisposition>([
  "fetched",
  "not_modified",
  "deleted",
  "fetch_failed",
]);

export interface OfficialWebStartPayload {
  collectorVersion?: unknown;
  configVersion?: unknown;
  crawlPolicyVersion?: unknown;
  hostSet?: unknown;
  runIntent?: unknown;
  schedulerRunKey?: unknown;
  seedSet?: unknown;
  siteId?: unknown;
  startedAt?: unknown;
  triggerType?: unknown;
}

export interface OfficialWebHeartbeatPayload {
  counts?: unknown;
  observedAt?: unknown;
  sequence?: unknown;
}

export interface OfficialWebFinalizePayload {
  artifacts?: unknown;
  finishedAt?: unknown;
  pageObservations?: unknown;
  summary?: unknown;
  terminalStatus?: unknown;
}

export interface OfficialWebCommandService {
  finalize(input: {
    payload: OfficialWebFinalizePayload;
    principal: OfficialWebCollectorPrincipal;
    runId: string;
  }): Promise<{
    run: {
      finishedAt: string | null;
      ingestionDispatchStatus: string;
      runId: string;
      status: string;
    };
  }>;
  heartbeat(input: {
    payload: OfficialWebHeartbeatPayload;
    principal: OfficialWebCollectorPrincipal;
    runId: string;
  }): Promise<{
    run: {
      lastHeartbeatAt: string | null;
      runId: string;
      status: string;
    };
  }>;
  start(input: {
    payload: OfficialWebStartPayload;
    principal: OfficialWebCollectorPrincipal;
  }): Promise<{
    run: {
      heartbeatIntervalSeconds: number;
      runId: string;
      siteId: string;
      startedAt: string;
      status: string;
    };
  }>;
}

export interface OfficialWebCommandServiceDependencies {
  computeFinalizeFingerprint?: (payload: NormalizedFinalizePayload) => string;
  computeStartFingerprint?: (payload: NormalizedStartPayload) => string;
  generateId?: (prefix: string) => string;
  heartbeatIntervalSeconds?: number;
  now?: () => Date;
  store: OfficialWebCommandStore;
}

interface NormalizedStartPayload {
  collectorVersion: string;
  configVersion: string;
  crawlPolicyVersion: string;
  hostSet: string[];
  runIntent: OfficialWebRunIntent;
  schedulerRunKey: string;
  seedSet: string[];
  siteId: string;
  startedAt: string;
  triggerType: string;
}

interface NormalizedHeartbeatPayload {
  counts: Record<string, number>;
  observedAt: string;
  sequence: number;
}

interface NormalizedFinalizePayload {
  artifacts: OfficialWebArtifactRecord[];
  finishedAt: string;
  pageObservations: NormalizedPageObservation[];
  summary: Record<string, number>;
  terminalStatus: OfficialWebTerminalRunStatus;
}

interface NormalizedPageObservation {
  contentType: string | null;
  discoveredFromUrl: string | null;
  discoveryMethod: string;
  etag: string | null;
  fetchDisposition: OfficialWebFetchDisposition;
  finalUrl: string;
  host: string;
  httpStatus: number | null;
  lastModified: string | null;
  mainContentHash: string | null;
  normalizedCanonicalUrl: string;
  observedAt: string;
  pageFamily: string;
  pageTitleNormalized: string;
  rawAssetId: string | null;
  rawVersionId: string | null;
  requestedUrl: string;
  responseBodyHash: string | null;
}

function defaultGenerateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function defaultComputeFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} is required.`,
      retryable: false,
      status: 422,
    });
  }

  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a valid ISO timestamp.`,
      retryable: false,
      status: 422,
    });
  }

  return timestamp.toISOString();
}

function normalizeStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a non-empty string array.`,
      retryable: false,
      status: 422,
    });
  }

  const normalized = [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))].sort();
  if (normalized.length === 0) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a non-empty string array.`,
      retryable: false,
      status: 422,
    });
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a non-negative integer.`,
      retryable: false,
      status: 422,
    });
  }

  return value;
}

function normalizeNumericRecord(value: unknown, field: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be an object.`,
      retryable: false,
      status: 422,
    });
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, number> = {};
  for (const [key, candidate] of entries) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `${field}.${key}` },
        message: `${field}.${key} must be a non-negative number.`,
        retryable: false,
        status: 422,
      });
    }

    normalized[key] = candidate;
  }

  return normalized;
}

function normalizeArtifacts(value: unknown): OfficialWebArtifactRecord[] {
  if (!Array.isArray(value)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "artifacts" },
      message: "artifacts must be an array.",
      retryable: false,
      status: 422,
    });
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `artifacts[${index}]` },
        message: "artifact must be an object.",
        retryable: false,
        status: 422,
      });
    }

    const artifact = item as Record<string, unknown>;
    const artifactType = normalizeString(artifact.artifactType);
    const objectKey = normalizeString(artifact.objectKey);
    const contentSha256 = normalizeString(artifact.contentSha256);
    if (!artifactType || !ALLOWED_ARTIFACT_TYPES.has(artifactType)) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `artifacts[${index}].artifactType` },
        message: "artifactType is not allowed.",
        retryable: false,
        status: 422,
      });
    }
    if (!objectKey || !contentSha256) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `artifacts[${index}]` },
        message: "artifactType, objectKey, and contentSha256 are required.",
        retryable: false,
        status: 422,
      });
    }

    return {
      artifactType,
      byteSize:
        typeof artifact.byteSize === "number" && Number.isInteger(artifact.byteSize)
          ? artifact.byteSize
          : null,
      contentSha256,
      objectKey,
      recordCount:
        typeof artifact.recordCount === "number" && Number.isInteger(artifact.recordCount)
          ? artifact.recordCount
          : null,
    } satisfies OfficialWebArtifactRecord;
  });
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeNullableInteger(value: unknown, field: string): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a non-negative integer when provided.`,
      retryable: false,
      status: 422,
    });
  }
  return value;
}

function normalizePageObservations(value: unknown): NormalizedPageObservation[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "pageObservations" },
      message: "pageObservations must be an array.",
      retryable: false,
      status: 422,
    });
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `pageObservations[${index}]` },
        message: "page observation must be an object.",
        retryable: false,
        status: 422,
      });
    }

    const observation = item as Record<string, unknown>;
    const fetchDisposition = normalizeString(
      observation.disposition ?? observation.fetchDisposition,
    ) as OfficialWebFetchDisposition;
    if (!ALLOWED_FETCH_DISPOSITIONS.has(fetchDisposition)) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `pageObservations[${index}].disposition` },
        message: "page observation disposition is invalid.",
        retryable: false,
        status: 422,
      });
    }

    const observedAt = normalizeIsoTimestamp(
      observation.observedAt ?? observation.fetchedAt,
      `pageObservations[${index}].observedAt`,
    );
    const requestedUrl = normalizeString(observation.requestedUrl);
    const finalUrl = normalizeString(observation.finalUrl);
    const normalizedCanonicalUrl = normalizeString(observation.normalizedCanonicalUrl);
    const host = normalizeString(observation.host);
    const pageFamily = normalizeString(observation.pageFamily);
    const pageTitleNormalized = normalizeString(observation.pageTitleNormalized);
    const discoveryMethod = normalizeString(observation.discoveryMethod);
    if (
      !requestedUrl ||
      !finalUrl ||
      !normalizedCanonicalUrl ||
      !host ||
      !pageFamily ||
      !pageTitleNormalized ||
      !discoveryMethod
    ) {
      throw new AppApiRouteError({
        code: "validation_failed",
        details: { field: `pageObservations[${index}]` },
        message:
          "requestedUrl, finalUrl, normalizedCanonicalUrl, host, pageFamily, pageTitleNormalized, and discoveryMethod are required.",
        retryable: false,
        status: 422,
      });
    }

    return {
      contentType: normalizeNullableString(observation.contentType),
      discoveredFromUrl: normalizeNullableString(observation.discoveredFromUrl),
      discoveryMethod,
      etag: normalizeNullableString(observation.etag),
      fetchDisposition,
      finalUrl,
      host,
      httpStatus: normalizeNullableInteger(observation.httpStatus, `pageObservations[${index}].httpStatus`),
      lastModified: normalizeNullableString(observation.lastModified),
      mainContentHash: normalizeNullableString(observation.mainContentHash),
      normalizedCanonicalUrl,
      observedAt,
      pageFamily,
      pageTitleNormalized,
      rawAssetId: normalizeNullableString(observation.rawAssetId),
      rawVersionId: normalizeNullableString(observation.rawVersionId),
      requestedUrl,
      responseBodyHash: normalizeNullableString(observation.responseBodyHash),
    } satisfies NormalizedPageObservation;
  });
}

function normalizeStartPayload(payload: OfficialWebStartPayload): NormalizedStartPayload {
  const siteId = normalizeString(payload.siteId);
  const schedulerRunKey = normalizeString(payload.schedulerRunKey);
  const runIntent = normalizeString(payload.runIntent) as OfficialWebRunIntent;
  const triggerType = normalizeString(payload.triggerType);
  const collectorVersion = normalizeString(payload.collectorVersion);
  const configVersion = normalizeString(payload.configVersion);
  const crawlPolicyVersion = normalizeString(payload.crawlPolicyVersion);

  if (
    !siteId ||
    !schedulerRunKey ||
    !runIntent ||
    !triggerType ||
    !collectorVersion ||
    !configVersion ||
    !crawlPolicyVersion
  ) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: {
        required: [
          "siteId",
          "schedulerRunKey",
          "runIntent",
          "triggerType",
          "collectorVersion",
          "configVersion",
          "crawlPolicyVersion",
        ],
      },
      message: "Missing required official_web start fields.",
      retryable: false,
      status: 422,
    });
  }
  if (!ALLOWED_RUN_INTENTS.has(runIntent)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "runIntent" },
      message: "runIntent is invalid.",
      retryable: false,
      status: 422,
    });
  }

  return {
    collectorVersion,
    configVersion,
    crawlPolicyVersion,
    hostSet: normalizeStringList(payload.hostSet, "hostSet"),
    runIntent,
    schedulerRunKey,
    seedSet: normalizeStringList(payload.seedSet, "seedSet"),
    siteId,
    startedAt: normalizeIsoTimestamp(payload.startedAt, "startedAt"),
    triggerType,
  };
}

function normalizeHeartbeatPayload(payload: OfficialWebHeartbeatPayload): NormalizedHeartbeatPayload {
  return {
    counts: normalizeNumericRecord(payload.counts, "counts"),
    observedAt: normalizeIsoTimestamp(payload.observedAt, "observedAt"),
    sequence: normalizePositiveInteger(payload.sequence, "sequence"),
  };
}

function normalizeFinalizePayload(payload: OfficialWebFinalizePayload): NormalizedFinalizePayload {
  const terminalStatus = normalizeString(payload.terminalStatus) as OfficialWebTerminalRunStatus;
  if (!FINALIZEABLE_TERMINAL_STATUSES.has(terminalStatus)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "terminalStatus" },
      message: "terminalStatus is invalid.",
      retryable: false,
      status: 422,
    });
  }

  const summary = normalizeNumericRecord(payload.summary, "summary");
  const failureCount = typeof summary.failureCount === "number" ? summary.failureCount : 0;
  if (terminalStatus === "completed" && failureCount > 0) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "terminalStatus" },
      message: "completed finalize payload cannot carry failureCount > 0.",
      retryable: false,
      status: 422,
    });
  }
  if (terminalStatus === "completed_with_errors" && failureCount < 1) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "terminalStatus" },
      message: "completed_with_errors requires failureCount > 0.",
      retryable: false,
      status: 422,
    });
  }

  return {
    artifacts: normalizeArtifacts(payload.artifacts ?? []),
    finishedAt: normalizeIsoTimestamp(payload.finishedAt, "finishedAt"),
    pageObservations: normalizePageObservations(payload.pageObservations),
    summary,
    terminalStatus,
  };
}

function classifyPageObservation(input: {
  observation: NormalizedPageObservation;
  previous: StoredOfficialWebPageFreshnessState | null;
}): { changeStatus: OfficialWebPageChangeStatus; reason: string } {
  const { observation, previous } = input;
  if (observation.fetchDisposition === "fetch_failed") {
    return {
      changeStatus: "fetch_failed",
      reason:
        observation.httpStatus != null
          ? `fetch_failed_http_${observation.httpStatus}`
          : "fetch_failed",
    };
  }
  if (
    observation.fetchDisposition === "deleted" ||
    observation.httpStatus === 404 ||
    observation.httpStatus === 410
  ) {
    return {
      changeStatus: "deleted",
      reason: "page_deleted",
    };
  }
  if (observation.fetchDisposition === "not_modified") {
    return {
      changeStatus: "not_modified",
      reason: "conditional_not_modified",
    };
  }
  if (!previous) {
    return {
      changeStatus: "new",
      reason: "first_seen",
    };
  }
  if (previous.mainContentHash !== observation.mainContentHash) {
    return {
      changeStatus: "changed",
      reason: "main_content_changed",
    };
  }
  if (previous.responseBodyHash !== observation.responseBodyHash) {
    return {
      changeStatus: "not_modified",
      reason: "response_noise_only",
    };
  }
  return {
    changeStatus: "not_modified",
    reason: "not_modified",
  };
}

function deriveCadenceClass(input: {
  fetchDisposition: OfficialWebFetchDisposition;
  pageFamily: string;
  runIntent: OfficialWebRunIntent;
}): string {
  if (input.fetchDisposition === "fetch_failed" || input.runIntent === "repair") {
    return "repair";
  }
  if (input.pageFamily === "listing_page") {
    return "listing_hot";
  }
  if (input.runIntent === "hot" || input.pageFamily === "article_detail") {
    return "detail_recent";
  }
  return "baseline_static";
}

function derivePriorityScore(cadenceClass: string): number {
  switch (cadenceClass) {
    case "repair":
      return 95;
    case "listing_hot":
      return 90;
    case "detail_recent":
      return 75;
    default:
      return 40;
  }
}

function deriveNextEligibleFetchAt(input: {
  cadenceClass: string;
  observedAt: string;
}): string {
  const observedAtMs = new Date(input.observedAt).valueOf();
  const delayMs =
    input.cadenceClass === "repair"
      ? 15 * 60 * 1000
      : input.cadenceClass === "listing_hot"
        ? 30 * 60 * 1000
        : input.cadenceClass === "detail_recent"
          ? 6 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
  return new Date(observedAtMs + delayMs).toISOString();
}

function deriveFreshnessState(input: {
  changeStatus: OfficialWebPageChangeStatus;
  observation: NormalizedPageObservation;
  previous: StoredOfficialWebPageFreshnessState | null;
  runId: string;
}): PersistedOfficialWebPageObservation["freshness"] {
  const { changeStatus, observation, previous, runId } = input;

  return {
    lastChangedAt:
      changeStatus === "new" || changeStatus === "changed" || changeStatus === "deleted"
        ? observation.observedAt
        : previous?.lastChangedAt ?? null,
    lastNotModifiedAt:
      changeStatus === "not_modified"
        ? observation.observedAt
        : changeStatus === "fetch_failed"
          ? previous?.lastNotModifiedAt ?? null
          : null,
    lastSuccessfulRunId:
      changeStatus === "deleted" || changeStatus === "fetch_failed"
        ? previous?.lastSuccessfulRunId ?? null
        : runId,
    mainContentHash: observation.mainContentHash ?? previous?.mainContentHash ?? null,
    responseBodyHash: observation.responseBodyHash ?? previous?.responseBodyHash ?? null,
  };
}

function buildPersistedPageObservations(input: {
  existingStates: Map<string, StoredOfficialWebPageFreshnessState>;
  generateId: (prefix: string) => string;
  pageObservations: NormalizedPageObservation[];
  run: StoredOfficialWebRun;
}): {
  observations: PersistedOfficialWebPageObservation[];
  pageChanges: OfficialWebPageChange[];
  summary: Record<string, number>;
} {
  const deduped = new Map<string, NormalizedPageObservation>();
  for (const observation of input.pageObservations) {
    deduped.set(observation.normalizedCanonicalUrl, observation);
  }

  const observations: PersistedOfficialWebPageObservation[] = [];
  const pageChanges: OfficialWebPageChange[] = [];
  const summary = {
    changedPages: 0,
    failedFetchPages: 0,
    deletedPages: 0,
    newPages: 0,
    notModifiedPages: 0,
  };

  for (const observation of deduped.values()) {
    const previous = input.existingStates.get(observation.normalizedCanonicalUrl) ?? null;
    const classified = classifyPageObservation({
      observation,
      previous,
    });
    const cadenceClass = deriveCadenceClass({
      fetchDisposition: observation.fetchDisposition,
      pageFamily: observation.pageFamily,
      runIntent: input.run.runIntent,
    });
    const priorityScore = derivePriorityScore(cadenceClass);
    const nextEligibleFetchAt = deriveNextEligibleFetchAt({
      cadenceClass,
      observedAt: observation.observedAt,
    });
    const freshness = deriveFreshnessState({
      changeStatus: classified.changeStatus,
      observation,
      previous,
      runId: input.run.runId,
    });

    if (classified.changeStatus === "new") {
      summary.newPages += 1;
    } else if (classified.changeStatus === "changed") {
      summary.changedPages += 1;
    } else if (classified.changeStatus === "deleted") {
      summary.deletedPages += 1;
    } else if (classified.changeStatus === "fetch_failed") {
      summary.failedFetchPages += 1;
    } else {
      summary.notModifiedPages += 1;
    }

    observations.push({
      cadenceClass,
      changeStatus: classified.changeStatus,
      contentType: observation.contentType,
      discoveredFromUrl: observation.discoveredFromUrl,
      discoveryMethod: observation.discoveryMethod,
      etag: observation.etag,
      fetchDisposition: observation.fetchDisposition,
      finalUrl: observation.finalUrl,
      host: observation.host,
      httpStatus: observation.httpStatus,
      lastChangeReason: classified.reason,
      lastModified: observation.lastModified,
      mainContentHash: observation.mainContentHash,
      nextEligibleFetchAt,
      normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
      observationId: input.generateId("owobs"),
      observedAt: observation.observedAt,
      pageFamily: observation.pageFamily,
      pageTitleNormalized: observation.pageTitleNormalized,
      priorityScore,
      rawAssetId: observation.rawAssetId,
      rawVersionId: observation.rawVersionId,
      requestedUrl: observation.requestedUrl,
      responseBodyHash: observation.responseBodyHash,
      runId: input.run.runId,
      runIntent: input.run.runIntent,
      siteId: input.run.siteId,
      freshness,
    });
    if (
      classified.changeStatus === "new" ||
      classified.changeStatus === "changed" ||
      classified.changeStatus === "deleted"
    ) {
      pageChanges.push({
        changeStatus: classified.changeStatus,
        normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
        observedAt: observation.observedAt,
        pageFamily: observation.pageFamily,
        rawAssetId: observation.rawAssetId,
        rawVersionId: observation.rawVersionId,
      });
    }
  }

  return {
    observations,
    pageChanges,
    summary,
  };
}

function buildStartResponse(run: StoredOfficialWebRun, heartbeatIntervalSeconds: number) {
  return {
    run: {
      heartbeatIntervalSeconds,
      runId: run.runId,
      siteId: run.siteId,
      startedAt: run.startedAt,
      status: run.status,
    },
  };
}

function buildHeartbeatResponse(run: StoredOfficialWebRun) {
  return {
    run: {
      lastHeartbeatAt: run.lastHeartbeatAt,
      runId: run.runId,
      status: run.status,
    },
  };
}

function buildFinalizeResponse(run: StoredOfficialWebRun) {
  return {
    run: {
      finishedAt: run.finishedAt,
      ingestionDispatchStatus: run.ingestionDispatchStatus,
      runId: run.runId,
      status: run.status,
    },
  };
}

function requireCollectorPrincipal(principal: OfficialWebCollectorPrincipal): void {
  if (principal.kind !== "service" || principal.serviceClass !== "official_web_collector") {
    throw new AppApiRouteError({
      code: "forbidden",
      message: "Official web collector access is not available for this principal.",
      retryable: false,
      status: 403,
    });
  }
}

function ensureRunExists(run: StoredOfficialWebRun | null, runId: string): StoredOfficialWebRun {
  if (run) {
    return run;
  }

  throw new AppApiRouteError({
    code: "run_not_found",
    details: { runId },
    message: "Official web run not found.",
    retryable: false,
    status: 404,
  });
}

function buildTerminalEventType(status: OfficialWebTerminalRunStatus): string {
  return `official_web.run.${status}`;
}

export function buildOfficialWebCommandService(
  dependencies: OfficialWebCommandServiceDependencies,
): OfficialWebCommandService {
  const computeFinalizeFingerprint =
    dependencies.computeFinalizeFingerprint ?? ((payload) => defaultComputeFingerprint(payload));
  const computeStartFingerprint =
    dependencies.computeStartFingerprint ?? ((payload) => defaultComputeFingerprint(payload));
  const generateId = dependencies.generateId ?? defaultGenerateId;
  const heartbeatIntervalSeconds =
    dependencies.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
  const now = dependencies.now ?? (() => new Date());

  return {
    async start(input) {
      requireCollectorPrincipal(input.principal);
      const normalized = normalizeStartPayload(input.payload);
      const startFingerprintSha256 = computeStartFingerprint(normalized);
      const existing = await dependencies.store.getRunBySchedulerKey(
        normalized.siteId,
        normalized.schedulerRunKey,
        normalized.runIntent,
      );

      if (existing) {
        if (existing.startFingerprintSha256 !== startFingerprintSha256) {
          throw new AppApiRouteError({
            code: "idempotency_conflict",
            message: "schedulerRunKey already exists with a different payload.",
            retryable: false,
            status: 409,
          });
        }

        return buildStartResponse(existing, heartbeatIntervalSeconds);
      }

      const acceptedAt = now().toISOString();
      const runId = generateId("owrun");
      const eventId = generateId("owevt_accepted");
      const run = await dependencies.store.acceptRun({
        outboxEvent: {
          attemptCount: 0,
          availableAt: acceptedAt,
          eventId,
          eventType: "official_web.run.accepted",
          lastError: null,
          occurredAt: acceptedAt,
          payload: {
            runId,
            runIntent: normalized.runIntent,
            schedulerRunKey: normalized.schedulerRunKey,
            siteId: normalized.siteId,
            startedAt: normalized.startedAt,
            status: "accepted",
          },
          processedAt: null,
          runId,
        },
        run: {
          collectorVersion: normalized.collectorVersion,
          configVersion: normalized.configVersion,
          crawlPolicyVersion: normalized.crawlPolicyVersion,
          finishedAt: null,
          hostSet: normalized.hostSet,
          ingestionDispatchRef: null,
          ingestionDispatchStatus: "pending",
          ingestionDispatchedAt: null,
          ingestionExecutionErrorCode: null,
          ingestionExecutionErrorMessage: null,
          ingestionExecutionRef: null,
          ingestionExecutionStatus: "pending",
          ingestionExecutionUpdatedAt: null,
          lastHeartbeatAt: null,
          latestHeartbeatSequence: 0,
          runId,
          runIntent: normalized.runIntent,
          schedulerRunKey: normalized.schedulerRunKey,
          seedSet: normalized.seedSet,
          siteId: normalized.siteId,
          startFingerprintSha256,
          startedAt: normalized.startedAt,
          status: "accepted",
          summary: null,
          terminalErrorCode: null,
          terminalErrorMessage: null,
          terminalPayloadSha256: null,
          triggerType: normalized.triggerType,
        },
      });

      return buildStartResponse(run, heartbeatIntervalSeconds);
    },

    async heartbeat(input) {
      requireCollectorPrincipal(input.principal);
      const normalizedRunId = normalizeString(input.runId);
      if (!normalizedRunId) {
        throw new AppApiRouteError({
          code: "run_not_found",
          message: "Official web run not found.",
          retryable: false,
          status: 404,
        });
      }

      const normalized = normalizeHeartbeatPayload(input.payload);
      const existing = ensureRunExists(
        await dependencies.store.getRunById(normalizedRunId),
        normalizedRunId,
      );

      if (TERMINAL_STATUSES.has(existing.status)) {
        throw new AppApiRouteError({
          code: existing.status === "abandoned" ? "run_abandoned" : "run_not_active",
          message:
            existing.status === "abandoned"
              ? "Official web run is already abandoned."
              : "Official web run is already terminal.",
          retryable: false,
          status: 409,
        });
      }
      if (normalized.sequence <= existing.latestHeartbeatSequence) {
        throw new AppApiRouteError({
          code: "heartbeat_out_of_order",
          message: "Heartbeat sequence must increase monotonically.",
          retryable: false,
          status: 409,
        });
      }

      const nextRun = await dependencies.store.appendHeartbeat({
        heartbeat: {
          counts: normalized.counts,
          createdAt: now().toISOString(),
          heartbeatId: generateId("owhb"),
          observedAt: normalized.observedAt,
          runId: existing.runId,
          sequence: normalized.sequence,
        },
        run: {
          ...existing,
          lastHeartbeatAt: normalized.observedAt,
          latestHeartbeatSequence: normalized.sequence,
          status: "running",
          summary: normalized.counts,
        },
      } satisfies AppendOfficialWebHeartbeatWrite);

      return buildHeartbeatResponse(nextRun);
    },

    async finalize(input) {
      requireCollectorPrincipal(input.principal);
      const normalizedRunId = normalizeString(input.runId);
      const existing = ensureRunExists(
        await dependencies.store.getRunById(normalizedRunId),
        normalizedRunId,
      );
      const normalized = normalizeFinalizePayload(input.payload);
      const terminalPayloadSha256 = computeFinalizeFingerprint(normalized);
      const terminalEventId = generateId("owevt_completed");
      const existingStates = await dependencies.store.listPageFreshnessStates(
        existing.siteId,
        normalized.pageObservations.map((item) => item.normalizedCanonicalUrl),
      );
      const pageObservationResult = buildPersistedPageObservations({
        existingStates: new Map(
          existingStates.map((item) => [item.normalizedCanonicalUrl, item] as const),
        ),
        generateId,
        pageObservations: normalized.pageObservations,
        run: existing,
      });
      const mergedSummary = {
        ...normalized.summary,
        ...pageObservationResult.summary,
      };

      if (existing.status === "abandoned") {
        throw new AppApiRouteError({
          code: "run_abandoned",
          message: "Official web run is already abandoned.",
          retryable: false,
          status: 409,
        });
      }
      if (TERMINAL_STATUSES.has(existing.status)) {
        if (existing.terminalPayloadSha256 === terminalPayloadSha256) {
          return buildFinalizeResponse(existing);
        }

        throw new AppApiRouteError({
          code: "run_already_finalized",
          message: "Official web run is already finalized with a different payload.",
          retryable: false,
          status: 409,
        });
      }

      const finalizedAt = now().toISOString();
      const nextRun = await dependencies.store.finalizeRun({
        artifacts: normalized.artifacts,
        observations: pageObservationResult.observations,
        outboxEvent: {
          attemptCount: 0,
          availableAt: finalizedAt,
          eventId: terminalEventId,
          eventType: buildTerminalEventType(normalized.terminalStatus),
          lastError: null,
          occurredAt: finalizedAt,
          payload: {
            artifacts: normalized.artifacts,
            finishedAt: normalized.finishedAt,
            pageChanges: pageObservationResult.pageChanges,
            pageChangeSummary: pageObservationResult.summary,
            runId: existing.runId,
            runIntent: existing.runIntent,
            schedulerRunKey: existing.schedulerRunKey,
            siteId: existing.siteId,
            status: normalized.terminalStatus,
            summary: mergedSummary,
          },
          processedAt: null,
          runId: existing.runId,
        },
        run: {
          ...existing,
          finishedAt: normalized.finishedAt,
          ingestionDispatchRef: null,
          ingestionDispatchStatus: "queued",
          ingestionExecutionErrorCode: existing.ingestionExecutionErrorCode,
          ingestionExecutionErrorMessage: existing.ingestionExecutionErrorMessage,
          ingestionExecutionRef: existing.ingestionExecutionRef,
          ingestionExecutionStatus: existing.ingestionExecutionStatus,
          ingestionExecutionUpdatedAt: existing.ingestionExecutionUpdatedAt,
          summary: mergedSummary,
          terminalPayloadSha256,
          status: normalized.terminalStatus,
        },
      } satisfies FinalizeOfficialWebRunWrite);

      return buildFinalizeResponse(nextRun);
    },
  };
}
