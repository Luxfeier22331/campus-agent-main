import { Hono } from "hono";

import {
  getMissingRuntimeConfig,
  readAppApiConfig,
  resolveAppName,
  type Env,
} from "./config";
import { AppApiRouteError, errorEnvelope, jsonResponse, routeErrorResponse } from "./http";
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
  handleAuthRequest,
  resolveRequestPrincipal,
  type ResolvedAppPrincipal,
} from "./modules/auth";

export interface AppDependencies {
  authHandler?: (request: Request, env: Env) => Promise<Response> | Response;
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
  const chatCommandService =
    dependencies.chatCommandService ??
    buildChatCommandService({
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

  app.get("/readyz", (c) => {
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

    readAppApiConfig(env);

    return jsonResponse({
      status: "ready",
      dependencies: {
        database: "configured",
        supervisorApi: "configured",
      },
    });
  });

  app.all("/api/auth/*", async (c) => {
    try {
      return await authHandler(c.req.raw, env);
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
