import type {
  OfficialWebPageObservationRecord,
  OfficialWebRunArtifactRef,
  OfficialWebRunArtifactType,
  OfficialWebRunIntent,
} from "./official-web-core.ts";

export type OfficialWebTriggerType = "scheduled" | "manual" | "replay";
export type OfficialWebTerminalStatus = "completed" | "completed_with_errors" | "failed";

export interface OfficialWebRunStartInput {
  siteId: string;
  schedulerRunKey: string;
  runIntent: OfficialWebRunIntent;
  triggerType: OfficialWebTriggerType;
  collectorVersion: string;
  configVersion: string;
  crawlPolicyVersion: string;
  hostSet: string[];
  seedSet: string[];
  startedAt: string;
  traceId?: string;
}

export interface OfficialWebHeartbeatInput {
  runId: string;
  sequence: number;
  observedAt: string;
  counts: {
    urlsDiscovered: number;
    urlsFetched: number;
    pagesNormalized: number;
    artifactUploads: number;
    failures: number;
  };
  traceId?: string;
}

export interface OfficialWebFinalizeInput {
  runId: string;
  terminalStatus: OfficialWebTerminalStatus;
  finishedAt: string;
  pageObservations?: OfficialWebPageObservationRecord[];
  summary: {
    urlsDiscovered: number;
    urlsFetched: number;
    pagesNormalized: number;
    rawAssetsObserved: number;
    failureCount: number;
  };
  artifacts: Array<
    Pick<OfficialWebRunArtifactRef, "contentSha256" | "objectKey" | "recordCount"> & {
      artifactType: OfficialWebRunArtifactType;
    }
  >;
  traceId?: string;
}

export interface OfficialWebControlPlaneStartResponse {
  run: {
    runId: string;
    siteId: string;
    status: string;
    startedAt: string;
    heartbeatIntervalSeconds?: number;
  };
}

export interface OfficialWebControlPlaneHeartbeatResponse {
  run: {
    runId: string;
    status: string;
    lastHeartbeatAt?: string;
  };
}

export interface OfficialWebControlPlaneFinalizeResponse {
  run: {
    runId: string;
    status: string;
    finishedAt?: string;
    ingestionDispatchStatus?: string;
  };
}

export interface OfficialWebPlannerPageCandidate {
  cadenceClass: string;
  contentType: string | null;
  discoveredFromUrl: string | null;
  discoveryMethod: "seed" | "robots_sitemap" | "configured_sitemap" | "navigation" | "manual_requeue";
  etag: string | null;
  host: string;
  lastChangeReason: string;
  lastChangedAt: string | null;
  lastFetchDisposition: "fetched" | "not_modified" | "deleted" | "fetch_failed";
  lastHttpStatus: number | null;
  lastModified: string | null;
  lastNotModifiedAt: string | null;
  lastSeenAt: string;
  lastSuccessfulRunId: string | null;
  mainContentHash: string | null;
  nextEligibleFetchAt: string;
  normalizedCanonicalUrl: string;
  pageFamily: string;
  pageTitleNormalized: string;
  priorityScore: number;
  responseBodyHash: string | null;
  siteId: string;
}

export interface OfficialWebControlPlanePlanResponse {
  plan: {
    duePages: OfficialWebPlannerPageCandidate[];
    hostFilter: string[];
    maxPagesPerHost: number;
    maxTotalPages: number;
    resolvedAt: string;
    runIntent: OfficialWebRunIntent;
    siteId: string;
    summary: {
      duePages: number;
      listingPages: number;
      repairPages: number;
      selectedHosts: number;
      staticPages: number;
    };
  };
}

export interface OfficialWebControlPlaneClient {
  startRun(input: OfficialWebRunStartInput): Promise<OfficialWebControlPlaneStartResponse>;
  sendHeartbeat(input: OfficialWebHeartbeatInput): Promise<OfficialWebControlPlaneHeartbeatResponse>;
  finalizeRun(input: OfficialWebFinalizeInput): Promise<OfficialWebControlPlaneFinalizeResponse>;
  resolvePlan(input: {
    hostFilter: string[];
    maxPagesPerHost: number;
    maxTotalPages: number;
    now: string;
    runIntent: OfficialWebRunIntent;
    siteId: string;
    traceId?: string;
  }): Promise<OfficialWebControlPlanePlanResponse>;
}

export class OfficialWebControlPlaneTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(input: { code: string; message: string; retryable: boolean; status: number }) {
    super(input.message);
    this.name = "OfficialWebControlPlaneTransportError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

export function createOfficialWebControlPlaneClient(
  env: {
    appApiBaseUrl?: string | null;
    serviceToken?: string | null;
  },
  input: {
    fetchImplementation?: typeof fetch;
  } = {},
): OfficialWebControlPlaneClient {
  const fetchImplementation = input.fetchImplementation ?? fetch;

  return {
    startRun(payload) {
      return requestJson<OfficialWebControlPlaneStartResponse>({
        baseUrl: env.appApiBaseUrl,
        serviceToken: env.serviceToken,
        path: "/api/official-web/runs",
        body: {
          siteId: payload.siteId,
          schedulerRunKey: payload.schedulerRunKey,
          runIntent: payload.runIntent,
          triggerType: payload.triggerType,
          collectorVersion: payload.collectorVersion,
          configVersion: payload.configVersion,
          crawlPolicyVersion: payload.crawlPolicyVersion,
          hostSet: payload.hostSet,
          seedSet: payload.seedSet,
          startedAt: payload.startedAt,
        },
        traceId: payload.traceId,
        fetchImplementation,
      });
    },

    sendHeartbeat(payload) {
      return requestJson<OfficialWebControlPlaneHeartbeatResponse>({
        baseUrl: env.appApiBaseUrl,
        serviceToken: env.serviceToken,
        path: `/api/official-web/runs/${payload.runId}/heartbeats`,
        body: {
          sequence: payload.sequence,
          observedAt: payload.observedAt,
          counts: payload.counts,
        },
        traceId: payload.traceId,
        fetchImplementation,
      });
    },

    finalizeRun(payload) {
      return requestJson<OfficialWebControlPlaneFinalizeResponse>({
        baseUrl: env.appApiBaseUrl,
        serviceToken: env.serviceToken,
        path: `/api/official-web/runs/${payload.runId}/finalize`,
        body: {
          terminalStatus: payload.terminalStatus,
          finishedAt: payload.finishedAt,
          pageObservations: payload.pageObservations ?? [],
          summary: payload.summary,
          artifacts: payload.artifacts,
        },
        traceId: payload.traceId,
        fetchImplementation,
      });
    },

    resolvePlan(payload) {
      return requestJson<OfficialWebControlPlanePlanResponse>({
        baseUrl: env.appApiBaseUrl,
        serviceToken: env.serviceToken,
        path: "/api/official-web/plans:resolve",
        body: {
          hostFilter: payload.hostFilter,
          maxPagesPerHost: payload.maxPagesPerHost,
          maxTotalPages: payload.maxTotalPages,
          now: payload.now,
          runIntent: payload.runIntent,
          siteId: payload.siteId,
        },
        traceId: payload.traceId,
        fetchImplementation,
      });
    },
  };
}

async function requestJson<T>(input: {
  baseUrl?: string | null;
  serviceToken?: string | null;
  path: string;
  body: Record<string, unknown>;
  traceId?: string;
  fetchImplementation: typeof fetch;
}): Promise<T> {
  const baseUrl = input.baseUrl?.trim();
  const serviceToken = input.serviceToken?.trim();
  if (!baseUrl || !serviceToken) {
    throw new OfficialWebControlPlaneTransportError({
      code: "dependency_not_ready",
      message: "Official-web control plane is not configured.",
      retryable: true,
      status: 503,
    });
  }

  let response: Response;
  try {
    response = await input.fetchImplementation(`${baseUrl}${input.path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "application/json",
        ...(input.traceId ? { "x-trace-id": input.traceId } : {}),
      },
      body: JSON.stringify(input.body),
    });
  } catch (error) {
    throw new OfficialWebControlPlaneTransportError({
      code: "app_api_unavailable",
      message: error instanceof Error ? error.message : "Official-web control plane request failed.",
      retryable: true,
      status: 502,
    });
  }

  const parsed = (await response.json().catch(() => null)) as
    | {
        error?: { code?: string; message?: string; retryable?: boolean };
      }
    | null;
  if (response.status !== 200) {
    throw new OfficialWebControlPlaneTransportError({
      code: parsed?.error?.code ?? "app_api_error",
      message: parsed?.error?.message ?? "Official-web control plane request failed.",
      retryable: parsed?.error?.retryable ?? response.status >= 500,
      status: response.status,
    });
  }

  return parsed as T;
}
