import { Hono } from "hono";

import {
  getMissingRuntimeConfig,
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
import {
  buildChatConversationService,
  createPgChatConversationStore,
  type ChatConversationService,
} from "./modules/chat";
import { createSupervisorExecutionClient } from "./modules/integration";
import {
  buildOfficialWebCommandService,
  createPgOfficialWebCommandStore,
  type OfficialWebCommandService,
} from "./modules/official-web-command";
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
  buildBetterAuthConfig,
  handleAuthRequest,
  resolveOfficialWebCollectorPrincipal,
  resolveRequestPrincipal,
  type ResolvedAppPrincipal,
} from "./modules/auth";

export interface AppDependencies {
  authHandler?: (request: Request, env: Env) => Promise<Response> | Response;
  chatConversationService?: ChatConversationService;
  chatCommandService?: ChatCommandService;
  getPrincipal?: (request: Request, env: Env) => Promise<ResolvedAppPrincipal | null>;
  officialWebCommandService?: OfficialWebCommandService;
  officialWebQueryService?: OfficialWebQueryService;
  operatorQueryService?: OperatorQueryService;
  telemetry?: AppTelemetry;
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

export function createApp(env: Env, dependencies: AppDependencies = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const authHandler = dependencies.authHandler ?? handleAuthRequest;
  const telemetry = dependencies.telemetry ?? createAppTelemetry(env);
  const chatConversationStore = createPgChatConversationStore(env);
  const chatConversationService =
    dependencies.chatConversationService ??
    buildChatConversationService({
      store: chatConversationStore,
    });
  const chatCommandService =
    dependencies.chatCommandService ??
    buildChatCommandService({
      conversationStore: chatConversationStore,
      store: createPgChatCommandStore(env),
      supervisor: createSupervisorExecutionClient(env),
      telemetry,
    });
  const getPrincipal = dependencies.getPrincipal ?? resolveRequestPrincipal;
  const officialWebCommandService =
    dependencies.officialWebCommandService ??
    buildOfficialWebCommandService({
      store: createPgOfficialWebCommandStore(env),
    });
  const officialWebQueryService =
    dependencies.officialWebQueryService ??
    buildOfficialWebQueryService({
      store: createPgOfficialWebQueryStore(env),
    });
  const operatorQueryService =
    dependencies.operatorQueryService ??
    buildOperatorQueryService({
      store: createPgOperatorQueryStore(env),
    });

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
      return jsonResponse(
        errorEnvelope({
          code: "dependency_not_ready",
          message: "Runtime configuration is incomplete.",
          retryable: true,
          details: {
            reason:
              error instanceof Error ? error.message : "Unable to initialize app-api runtime.",
          },
        }),
        { status: 503 },
      );
    }

    return jsonResponse({
      status: "ready",
      dependencies: {
        auth: "configured",
        database: "configured",
        officialWebHandoff:
          env.APP_API_OFFICIAL_WEB_HANDOFF_URL?.trim() && env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?.trim()
            ? "configured"
            : "not_configured",
        operatorBridge: "configured",
        publicChatOrigin: "configured",
        supervisorApi: "configured",
      },
    });
  });

  app.all("/api/auth/*", async (c) => {
    try {
      return withNoStore(await authHandler(c.req.raw, env));
    } catch {
      return dependencyNotReadyResponse();
    }
  });

  app.get("/api/me", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const payload = await readJsonRequestBody(c.req.raw);

    const response = await chatCommandService.submit({
      idempotencyKey: c.req.header("idempotency-key") ?? null,
      payload,
      principal,
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
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await officialWebCommandService.start({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
    });

    return jsonResponse(response);
  });

  app.post("/api/official-web/runs/:runId/heartbeats", async (c) => {
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await officialWebCommandService.heartbeat({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
      runId: c.req.param("runId"),
    });

    return jsonResponse(response);
  });

  app.post("/api/official-web/runs/:runId/finalize", async (c) => {
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await officialWebCommandService.finalize({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
      runId: c.req.param("runId"),
    });

    return jsonResponse(response);
  });

  app.get("/api/chat/conversations", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const response = await chatConversationService.list({ principal });
    return jsonResponse(response);
  });

  app.post("/api/chat/conversations", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const response = await chatConversationService.createDraft({ principal });
    return jsonResponse(response, { status: 201 });
  });

  app.get("/api/chat/conversations/:conversationId", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }

    const response = await chatConversationService.getById({
      conversationId: c.req.param("conversationId"),
      principal,
    });
    return jsonResponse(response);
  });

  app.get("/api/operator/overview", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.getOverview({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/quality/summary", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.getQualitySummary({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/safety/summary", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.getSafetySummary({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/cost/summary", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.getCostSummary({
        filters: readOperatorAggregateFilters(c.req),
        principal,
      }),
    );
  });

  app.get("/api/operator/audit", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.listAudit({
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
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.getAuditById({
        auditEventId: c.req.param("auditEventId"),
        principal,
      }),
    );
  });

  app.get("/api/operator/requests", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    const response = await operatorQueryService.list({
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
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
    } catch {
      return dependencyNotReadyResponse();
    }

    if (!principal) {
      return sessionRequiredResponse();
    }
    if (!principal.permissions.operator) {
      return operatorAccessForbiddenResponse();
    }

    const request = await operatorQueryService.getById({
      principal,
      requestId: c.req.param("requestId"),
    });

    return jsonResponse({ request });
  });

  app.get("/api/operator/requests/:requestId/observability", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await operatorQueryService.getObservabilityById({
        principal,
        requestId: c.req.param("requestId"),
      }),
    );
  });

  app.get("/api/operator/official-web/sites", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await officialWebQueryService.listSites({
        principal,
      }),
    );
  });

  app.get("/api/operator/official-web/sites/:siteId", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await officialWebQueryService.getSiteById({
        principal,
        siteId: c.req.param("siteId"),
      }),
    );
  });

  app.get("/api/operator/official-web/runs", async (c) => {
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      await officialWebQueryService.listRuns({
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
    let principal: ResolvedAppPrincipal | null = null;

    try {
      principal = await getPrincipal(c.req.raw, env);
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
      run: await officialWebQueryService.getRunById({
        principal,
        runId: c.req.param("runId"),
      }),
    });
  });

  app.onError((error, c) => {
    if (error instanceof AppApiRouteError) {
      return routeErrorResponse(error);
    }

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
