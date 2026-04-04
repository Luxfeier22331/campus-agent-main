import { Hono } from "hono";

import {
  getMissingRuntimeConfig,
  parseCsvList,
  readAppApiConfig,
  resolveAppName,
  type Env,
} from "./config";
import {
  AppApiRouteError,
  errorEnvelope,
  jsonResponse,
  routeErrorResponse,
  withNoStore,
} from "./http";
import { probeRuntimeDatabase } from "./db/runtime";
import {
  buildChatConversationService,
  createPgChatConversationStore,
  type ChatConversationService,
} from "./modules/chat";
import { createSupervisorExecutionClient, probeSupervisorApiReady } from "./modules/integration";
import {
  buildOfficialWebCommandService,
  createPgOfficialWebCommandStore,
  type OfficialWebCommandService,
} from "./modules/official-web-command";
import {
  buildOperatorObservabilityCommandService,
  createPgOperatorObservabilityCommandStore,
  type OperatorObservabilityCommandService,
} from "./modules/operator-observability-command";
import {
  buildOfficialWebQueryService,
  createPgOfficialWebQueryStore,
  type OfficialWebQueryService,
} from "./modules/official-web-query";
import {
  buildOperatorQueryService,
  createPgOperatorQueryStore,
  type OperatorQueryService,
} from "./modules/operator-query";
import {
  buildChatCommandService,
  createPgChatCommandStore,
  type ChatCommandService,
} from "./modules/runtime-command";
import { createAppTelemetry, type AppTelemetry } from "./modules/telemetry";
import {
  buildInternalEvalPrincipal,
  buildBetterAuthConfig,
  hasMatchingInternalSecret,
  handleAuthRequest,
  probeAppAuthRuntime,
  resolveOfficialWebCollectorPrincipal,
  resolveRequestPrincipal,
  type AppAuthResolutionInput,
  type ResolvedAppPrincipal,
} from "./modules/auth";
import { createRequestRuntimeScope } from "./request-runtime-scope";

export interface AppDependencies {
  authHandler?: (request: Request, env: Env, input?: AppAuthResolutionInput) => Promise<Response> | Response;
  chatConversationService?: ChatConversationService;
  chatCommandService?: ChatCommandService;
  getPrincipal?: (
    request: Request,
    env: Env,
    input?: AppAuthResolutionInput,
  ) => Promise<ResolvedAppPrincipal | null>;
  officialWebCommandService?: OfficialWebCommandService;
  officialWebQueryService?: OfficialWebQueryService;
  operatorObservabilityCommandService?: OperatorObservabilityCommandService;
  operatorQueryService?: OperatorQueryService;
  scheduleRequestProjectionDrain?: (input: {
    requestId: string;
    waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  }) => void;
  telemetry?: AppTelemetry;
  runtimeReadinessProbe?: () => Promise<AppRuntimeReadinessResult>;
}
type AppRuntimeDependencyName = "auth" | "database" | "supervisorApi";

export interface AppRuntimeReadinessResult {
  dependencies: {
    auth: "ready" | "not_ready";
    database: "ready" | "not_ready";
    officialWebHandoff: "configured" | "not_configured";
    operatorBridge: "configured";
    publicChatOrigin: "configured";
    supervisorApi: "ready" | "not_ready";
  };
  failed: Partial<Record<AppRuntimeDependencyName, string>>;
}

function dependencyNotReadyResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "dependency_not_ready",
      message: "Runtime configuration is incomplete.",
      retryable: true,
    }),
    { status: 503 },
  );
}

function sessionRequiredResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "session_required",
      message: "Sign in required.",
      retryable: false,
    }),
    { status: 401 },
  );
}

function serviceCredentialRequiredResponse() {
  return jsonResponse(
    errorEnvelope({
      code: "service_credential_required",
      message: "Collector service credential required.",
      retryable: false,
    }),
    { status: 401 },
  );
}

function buildInternalEvalPrincipalFromRequest(request: Request): ResolvedAppPrincipal {
  return buildInternalEvalPrincipal({
    actorRoles: parseCsvList(request.headers.get("x-eval-actor-roles") ?? undefined),
    applicabilityScope: request.headers.get("x-eval-applicability-scope") ?? undefined,
    cohort: request.headers.get("x-eval-cohort") ?? undefined,
    departments: parseCsvList(request.headers.get("x-eval-departments") ?? undefined),
    displayName: request.headers.get("x-eval-user-name") ?? undefined,
    email: request.headers.get("x-eval-user-email") ?? "",
    major: request.headers.get("x-eval-major") ?? undefined,
    entitlementGroups: parseCsvList(request.headers.get("x-eval-entitlement-groups") ?? undefined),
    entitlementSnapshotId: request.headers.get("x-eval-entitlement-snapshot-id") ?? undefined,
    ownershipScopes: parseCsvList(request.headers.get("x-eval-ownership-scopes") ?? undefined),
    principalId: request.headers.get("x-eval-user-id") ?? undefined,
    principalType:
      (request.headers.get("x-eval-principal-type") as
        | "public_user"
        | "campus_member"
        | "student"
        | "staff"
        | "faculty"
        | null) ?? undefined,
    program: request.headers.get("x-eval-program") ?? undefined,
    visibilityLevel: request.headers.get("x-eval-visibility-level") ?? undefined,
    visibilityScope: request.headers.get("x-eval-visibility-scope"),
  });
}

function parseLimit(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOperatorAggregateFilters(request: {
  query(name: string): string | undefined;
}) {
  return {
    collection: request.query("collection") ?? null,
    granularity: request.query("granularity") ?? null,
    modelName: request.query("modelName") ?? null,
    principalType: request.query("principalType") ?? null,
    requestedCapability: request.query("requestedCapability") ?? null,
    selectedTarget: request.query("selectedTarget") ?? null,
    surface: request.query("surface") ?? null,
    window: request.query("window") ?? null,
  };
}

function operatorAccessForbiddenResponse() {
  return routeErrorResponse(
    new AppApiRouteError({
      code: "forbidden",
      message: "Operator access is not available for this principal.",
      retryable: false,
      status: 403,
    }),
  );
}

function resolveRequestSurface(request: Request): string {
  const pathname = new URL(request.url).pathname;

  if (pathname.startsWith("/api/operator/")) {
    return "protected_panel_web";
  }
  if (pathname.startsWith("/api/official-web/")) {
    return "official_web";
  }
  if (pathname.startsWith("/api/chat/") || pathname.startsWith("/api/auth/") || pathname === "/api/me") {
    return "public_chat_web";
  }

  return "app_api";
}

async function readJsonRequestBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppApiRouteError({
      code: "unsupported_media_type",
      message: "application/json is required.",
      retryable: false,
      status: 415,
    });
  }

  const payload = (await request.json().catch(() => {
    throw new AppApiRouteError({
      code: "invalid_json",
      message: "Invalid JSON body.",
      retryable: false,
      status: 400,
    });
  })) as unknown;

  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function resolveWaitUntil(
  context: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } } | null | undefined,
): ((promise: Promise<unknown>) => void) | undefined {
  try {
    return context?.executionCtx?.waitUntil.bind(context.executionCtx);
  } catch {
    return undefined;
  }
}

function formatRuntimeDependencyFailure(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown dependency probe failure.";
}

async function defaultRuntimeReadinessProbe(env: Env): Promise<AppRuntimeReadinessResult> {
  const dependencies: AppRuntimeReadinessResult["dependencies"] = {
    auth: "not_ready",
    database: "not_ready",
    officialWebHandoff:
      env.APP_API_OFFICIAL_WEB_HANDOFF_URL?.trim() && env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?.trim()
        ? "configured"
        : "not_configured",
    operatorBridge: "configured",
    publicChatOrigin: "configured",
    supervisorApi: "not_ready",
  };
  const failed: AppRuntimeReadinessResult["failed"] = {};

  try {
    const config = readAppApiConfig(env);
    buildBetterAuthConfig({
      appName: config.appName,
      betterAuthSecret: config.betterAuthSecret,
      database: {},
      environment: config.environment,
      publicChatOrigin: config.publicChatOrigin,
    });
  } catch (error) {
    return {
      dependencies,
      failed: {
        auth: formatRuntimeDependencyFailure(error),
        database: formatRuntimeDependencyFailure(error),
        supervisorApi: formatRuntimeDependencyFailure(error),
      },
    };
  }

  try {
    await probeRuntimeDatabase(env);
    dependencies.database = "ready";
  } catch (error) {
    failed.database = formatRuntimeDependencyFailure(error);
  }

  try {
    await probeAppAuthRuntime(env);
    dependencies.auth = "ready";
  } catch (error) {
    failed.auth = formatRuntimeDependencyFailure(error);
  }

  try {
    await probeSupervisorApiReady(env);
    dependencies.supervisorApi = "ready";
  } catch (error) {
    failed.supervisorApi = formatRuntimeDependencyFailure(error);
  }

  return {
    dependencies,
    failed,
  };
}

export function createApp(env: Env, dependencies: AppDependencies = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const authHandler = dependencies.authHandler ?? handleAuthRequest;
  const telemetry = dependencies.telemetry ?? createAppTelemetry(env);
  const getPrincipal = dependencies.getPrincipal ?? resolveRequestPrincipal;
  const runtimeReadinessProbe = dependencies.runtimeReadinessProbe ?? (() => defaultRuntimeReadinessProbe(env));
  const scheduleRequestProjectionDrain = dependencies.scheduleRequestProjectionDrain;

  function createRequestScope() {
    const runtime = createRequestRuntimeScope(env);
    let chatConversationService = dependencies.chatConversationService ?? null;
    let chatCommandService = dependencies.chatCommandService ?? null;
    let officialWebCommandService = dependencies.officialWebCommandService ?? null;
    let officialWebQueryService = dependencies.officialWebQueryService ?? null;
    let operatorObservabilityCommandService =
      dependencies.operatorObservabilityCommandService ?? null;
    let operatorQueryService = dependencies.operatorQueryService ?? null;

    function resolveChatConversationService(): ChatConversationService {
      if (chatConversationService) {
        return chatConversationService;
      }

      chatConversationService = buildChatConversationService({
        store: createPgChatConversationStore(env, { getDb: runtime.getFreshDb }),
      });
      return chatConversationService;
    }

    function resolveChatCommandService(): ChatCommandService {
      if (chatCommandService) {
        return chatCommandService;
      }

      const chatConversationStore = createPgChatConversationStore(env, { getDb: runtime.getFreshDb });
      chatCommandService = buildChatCommandService({
        conversationStore: chatConversationStore,
        store: createPgChatCommandStore(env, { getDb: runtime.getFreshDb }),
        supervisor: createSupervisorExecutionClient(env),
        telemetry,
      });
      return chatCommandService;
    }

    function resolveOfficialWebCommandService(): OfficialWebCommandService {
      if (officialWebCommandService) {
        return officialWebCommandService;
      }

      officialWebCommandService = buildOfficialWebCommandService({
        store: createPgOfficialWebCommandStore(env, { getDb: runtime.getFreshDb }),
      });
      return officialWebCommandService;
    }

    function resolveOfficialWebQueryService(): OfficialWebQueryService {
      if (officialWebQueryService) {
        return officialWebQueryService;
      }

      officialWebQueryService = buildOfficialWebQueryService({
        store: createPgOfficialWebQueryStore(env, { getDb: runtime.getDb }),
      });
      return officialWebQueryService;
    }

    function resolveOperatorQueryService(): OperatorQueryService {
      if (operatorQueryService) {
        return operatorQueryService;
      }

      operatorQueryService = buildOperatorQueryService({
        store: createPgOperatorQueryStore(env, { getDb: runtime.getDb }),
      });
      return operatorQueryService;
    }

    function resolveOperatorObservabilityCommandService(): OperatorObservabilityCommandService {
      if (operatorObservabilityCommandService) {
        return operatorObservabilityCommandService;
      }

      operatorObservabilityCommandService = buildOperatorObservabilityCommandService({
        store: createPgOperatorObservabilityCommandStore(env, { getDb: runtime.getFreshDb }),
      });
      return operatorObservabilityCommandService;
    }

    return {
      getAppAuth: runtime.getAppAuth,
      resolveChatCommandService,
      resolveChatConversationService,
      resolveOfficialWebCommandService,
      resolveOfficialWebQueryService,
      resolveOperatorObservabilityCommandService,
      resolveOperatorQueryService,
    };
  }

  async function resolvePrincipalForScope(
    request: Request,
    scope: ReturnType<typeof createRequestScope>,
  ): Promise<ResolvedAppPrincipal | null> {
    return getPrincipal(request, env, {
      getAppAuth: scope.getAppAuth,
    });
  }

  app.use("*", async (c, next) => {
    telemetry.configureHttpRequestScope({
      route: c.req.path,
      surface: resolveRequestSurface(c.req.raw),
      traceId: c.req.header("x-trace-id"),
    });

    await next();

    telemetry.markHttpResponseStatus(c.res.status);
  });

  app.get("/healthz", (c) =>
    jsonResponse({
      status: "ok",
      app: resolveAppName(env),
    }),
  );

  app.get("/readyz", async (c) => {
    const missing = getMissingRuntimeConfig(env);
    if (missing.length > 0) {
      return jsonResponse(
        errorEnvelope({
          code: "dependency_not_ready",
          message: "Runtime configuration is incomplete.",
          retryable: true,
          details: { missing },
        }),
        { status: 503 },
      );
    }

    const readiness = await runtimeReadinessProbe();
    if (Object.keys(readiness.failed).length > 0) {
      return jsonResponse(
        errorEnvelope({
          code: "dependency_not_ready",
          message: "Runtime dependencies are not ready.",
          retryable: true,
          details: {
            failed: readiness.failed,
          },
        }),
        { status: 503 },
      );
    }

    return jsonResponse({
      status: "ready",
      dependencies: readiness.dependencies,
    });
  });

  app.all("/api/auth/*", async (c) => {
    const scope = createRequestScope();

    try {
      return withNoStore(
        await authHandler(c.req.raw, env, {
          getAppAuth: scope.getAppAuth,
        }),
      );
    } catch {
      return dependencyNotReadyResponse();
    }
  });

  app.get("/api/me", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    return jsonResponse({
      principal: principal.principal,
      session: principal.session,
      permissions: principal.permissions,
    });
  });

  app.post("/api/chat/requests", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const payload = await readJsonRequestBody(c.req.raw);

    const response = await scope.resolveChatCommandService().submit({
      idempotencyKey: c.req.header("idempotency-key") ?? null,
      payload,
      principal,
    });
    scheduleRequestProjectionDrain?.({
      requestId: response.requestId,
      waitUntil: resolveWaitUntil(c),
    });

    return jsonResponse(
      {
        answer: response.answer,
      },
      {
        headers: {
          "x-request-id": response.requestId,
          "x-trace-id": response.traceId,
        },
        status: 200,
      },
    );
  });

  app.post("/api/official-web/runs", async (c) => {
    const scope = createRequestScope();
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await scope.resolveOfficialWebCommandService().start({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
    });

    return jsonResponse(response);
  });

  app.post("/api/official-web/runs/:runId/heartbeats", async (c) => {
    const scope = createRequestScope();
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await scope.resolveOfficialWebCommandService().heartbeat({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
      runId: c.req.param("runId"),
    });

    return jsonResponse(response);
  });

  app.post("/api/official-web/runs/:runId/finalize", async (c) => {
    const scope = createRequestScope();
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await scope.resolveOfficialWebCommandService().finalize({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
      runId: c.req.param("runId"),
    });

    return jsonResponse(response);
  });

  app.post("/api/internal/operator/quality/grades", async (c) => {
    const scope = createRequestScope();
    if (!hasMatchingInternalSecret(c.req.raw, env)) {
      return serviceCredentialRequiredResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorObservabilityCommandService().ingestGrades({
        payload: await readJsonRequestBody(c.req.raw),
      }),
    );
  });

  app.post("/api/internal/operator/trace-backlinks", async (c) => {
    const scope = createRequestScope();
    if (!hasMatchingInternalSecret(c.req.raw, env)) {
      return serviceCredentialRequiredResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorObservabilityCommandService().ingestTraceBacklinks({
        payload: await readJsonRequestBody(c.req.raw),
      }),
    );
  });

  app.post("/api/internal/evals/chat/requests", async (c) => {
    const scope = createRequestScope();
    if (!hasMatchingInternalSecret(c.req.raw, env)) {
      return serviceCredentialRequiredResponse();
    }

    const response = await scope.resolveChatCommandService().submit({
      idempotencyKey: c.req.header("idempotency-key") ?? null,
      payload: await readJsonRequestBody(c.req.raw),
      principal: buildInternalEvalPrincipalFromRequest(c.req.raw),
      surface: "eval_benchmark",
    });

    return jsonResponse(
      {
        answer: response.answer,
        supervisor: response.supervisor ?? null,
      },
      {
        headers: {
          "x-request-id": response.requestId,
          "x-trace-id": response.traceId,
        },
        status: 200,
      },
    );
  });

  app.get("/api/chat/conversations", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const response = await scope.resolveChatConversationService().list({ principal });
    return jsonResponse(response);
  });

  app.post("/api/chat/conversations", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const response = await scope.resolveChatConversationService().createDraft({ principal });
    return jsonResponse(response, { status: 201 });
  });

  app.get("/api/chat/conversations/:conversationId", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const response = await scope.resolveChatConversationService().getById({
      conversationId: c.req.param("conversationId"),
      principal,
    });
    return jsonResponse(response);
  });

  app.get("/api/operator/overview", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getOverview({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/quality/summary", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getQualitySummary({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/quality/timeseries", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getQualityTimeseries({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/quality/badcases", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().listQualityBadcases({
        filters: {
          causeClass: c.req.query("causeClass") ?? null,
          cursor: c.req.query("cursor") ?? null,
          detectedBy: c.req.query("detectedBy") ?? null,
          limit: parseLimit(c.req.query("limit")),
          status: c.req.query("status") ?? null,
        },
        principal,
      }),
    );
  });

  app.get("/api/operator/safety/summary", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getSafetySummary({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/cost/summary", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getCostSummary({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/audit", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().listAudit({
        filters: {
          cursor: c.req.query("cursor") ?? null,
          eventType: c.req.query("eventType") ?? null,
          limit: parseLimit(c.req.query("limit")),
          principalType: c.req.query("principalType") ?? null,
          requestId: c.req.query("requestId") ?? null,
          selectedTarget: c.req.query("selectedTarget") ?? null,
          status: c.req.query("status") ?? null,
          surface: c.req.query("surface") ?? null,
          traceId: c.req.query("traceId") ?? null,
        },
        principal,
      }),
    );
  });

  app.get("/api/operator/audit/:auditEventId", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getAuditById({
        auditEventId: c.req.param("auditEventId"),
        principal,
      }),
    );
  });

  app.get("/api/operator/requests", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    const response = await scope.resolveOperatorQueryService().list({
      filters: {
        conversationId: c.req.query("conversationId") ?? null,
        cursor: c.req.query("cursor") ?? null,
        limit: parseLimit(c.req.query("limit")),
        requestId: c.req.query("requestId") ?? null,
        status: c.req.query("status") ?? null,
        surface: c.req.query("surface") ?? null,
      },
      principal,
    });

    return jsonResponse(response);
  });

  app.get("/api/operator/requests/:requestId", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    const request = await scope.resolveOperatorQueryService().getById({
      principal,
      requestId: c.req.param("requestId"),
    });

    return jsonResponse({ request });
  });

  app.get("/api/operator/requests/:requestId/observability", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorQueryService().getObservabilityById({
        principal,
        requestId: c.req.param("requestId"),
      }),
    );
  });

  app.get("/api/operator/official-web/sites", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOfficialWebQueryService().listSites({
        principal,
      }),
    );
  });

  app.get("/api/operator/official-web/sites/:siteId", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOfficialWebQueryService().getSiteById({
        principal,
        siteId: c.req.param("siteId"),
      }),
    );
  });

  app.get("/api/operator/official-web/runs", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse(
      await scope.resolveOfficialWebQueryService().listRuns({
        filters: {
          cursor: c.req.query("cursor") ?? null,
          ingestionDispatchStatus: c.req.query("ingestionDispatchStatus") ?? null,
          limit: parseLimit(c.req.query("limit")),
          siteId: c.req.query("siteId") ?? null,
          startedAfter: c.req.query("startedAfter") ?? null,
          startedBefore: c.req.query("startedBefore") ?? null,
          status: c.req.query("status") ?? null,
        },
        principal,
      }),
    );
  });

  app.get("/api/operator/official-web/runs/:runId", async (c) => {
    const scope = createRequestScope();
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await resolvePrincipalForScope(c.req.raw, scope);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    return jsonResponse({
      run: await scope.resolveOfficialWebQueryService().getRunById({
        principal,
        runId: c.req.param("runId"),
      }),
    });
  });

  app.onError((error, c) => {
    if (error instanceof AppApiRouteError) {
      return routeErrorResponse(error);
    }

    console.error(
      JSON.stringify({
        error:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
              }
            : {
                message: String(error),
                name: "UnknownError",
              },
        route: c.req.path,
        source: "app-api.onError",
        surface: resolveRequestSurface(c.req.raw),
      }),
    );

    telemetry.captureException(error, {
      route: c.req.path,
      status: 500,
      surface: resolveRequestSurface(c.req.raw),
      traceId: c.req.header("x-trace-id"),
    });

    return jsonResponse(
      errorEnvelope({
        code: "internal_error",
        message: "Unexpected app-api failure.",
        retryable: true,
      }),
      { status: 500 },
    );
  });

  app.notFound(() =>
    jsonResponse(
      errorEnvelope({
        code: "not_found",
        message: "Route not found.",
        retryable: false,
      }),
      { status: 404 },
    ),
  );

  return app;
}
