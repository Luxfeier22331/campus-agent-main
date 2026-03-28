import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { OfficialWebCollectorPrincipal } from "../auth";
import type {
  AppendOfficialWebHeartbeatWrite,
  FinalizeOfficialWebRunWrite,
  OfficialWebArtifactRecord,
  OfficialWebCommandStore,
  OfficialWebRunStatus,
  OfficialWebTerminalRunStatus,
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
]);

export interface OfficialWebStartPayload {
  collectorVersion?: unknown;
  configVersion?: unknown;
  crawlPolicyVersion?: unknown;
  hostSet?: unknown;
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
  summary: Record<string, number>;
  terminalStatus: OfficialWebTerminalRunStatus;
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

function normalizeStartPayload(payload: OfficialWebStartPayload): NormalizedStartPayload {
  const siteId = normalizeString(payload.siteId);
  const schedulerRunKey = normalizeString(payload.schedulerRunKey);
  const triggerType = normalizeString(payload.triggerType);
  const collectorVersion = normalizeString(payload.collectorVersion);
  const configVersion = normalizeString(payload.configVersion);
  const crawlPolicyVersion = normalizeString(payload.crawlPolicyVersion);

  if (
    !siteId ||
    !schedulerRunKey ||
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

  return {
    collectorVersion,
    configVersion,
    crawlPolicyVersion,
    hostSet: normalizeStringList(payload.hostSet, "hostSet"),
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
    summary,
    terminalStatus,
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
          lastHeartbeatAt: null,
          latestHeartbeatSequence: 0,
          runId,
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
        outboxEvent: {
          attemptCount: 0,
          availableAt: finalizedAt,
          eventId: generateId("owevt_completed"),
          eventType: buildTerminalEventType(normalized.terminalStatus),
          lastError: null,
          occurredAt: finalizedAt,
          payload: {
            artifacts: normalized.artifacts,
            finishedAt: normalized.finishedAt,
            runId: existing.runId,
            schedulerRunKey: existing.schedulerRunKey,
            siteId: existing.siteId,
            status: normalized.terminalStatus,
            summary: normalized.summary,
          },
          processedAt: null,
          runId: existing.runId,
        },
        run: {
          ...existing,
          finishedAt: normalized.finishedAt,
          ingestionDispatchRef: null,
          ingestionDispatchStatus: "queued",
          summary: normalized.summary,
          terminalPayloadSha256,
          status: normalized.terminalStatus,
        },
      } satisfies FinalizeOfficialWebRunWrite);

      return buildFinalizeResponse(nextRun);
    },
  };
}
