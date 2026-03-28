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
  buildOperatorQueryService,
  createPgOperatorQueryStore,
  type OperatorQueryService,
} from "./modules/operator-query";
import {
  buildChatCommandService,
  createPgChatCommandStore,
  type ChatCommandService,
} from "./modules/runtime-command";
import {
  buildBetterAuthConfig,
  handleAuthRequest,
  resolveRequestPrincipal,
  type ResolvedAppPrincipal,
} from "./modules/auth";

export interface AppDependencies {
  authHandler?: (request: Request, env: Env) => Promise<Response> | Response;
  chatConversationService?: ChatConversationService;
  chatCommandService?: ChatCommandService;
  getPrincipal?: (request: Request, env: Env) => Promise<ResolvedAppPrincipal | null>;
  operatorQueryService?: OperatorQueryService;
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

function parseLimit(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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

export function createApp(env: Env, dependencies: AppDependencies = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const authHandler = dependencies.authHandler ?? handleAuthRequest;
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
    });
  const getPrincipal = dependencies.getPrincipal ?? resolveRequestPrincipal;
  const operatorQueryService =
    dependencies.operatorQueryService ??
    buildOperatorQueryService({
      store: createPgOperatorQueryStore(env),
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

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return routeErrorResponse(
        new AppApiRouteError({
          code: "unsupported_media_type",
          message: "application/json is required.",
          retryable: false,
          status: 415,
        }),
      );
    }

    const payload = (await c.req.raw.json().catch(() => {
      throw new AppApiRouteError({
        code: "invalid_json",
        message: "Invalid JSON body.",
        retryable: false,
        status: 400,
      });
    })) as Record<string, unknown>;

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

  app.onError((error) => {
    if (error instanceof AppApiRouteError) {
      return routeErrorResponse(error);
    }

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
