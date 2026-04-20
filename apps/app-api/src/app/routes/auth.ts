import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse, withNoStore } from "../../http";
import { requireSessionPrincipal } from "../principal";
import { dependencyNotReadyResponse } from "../responses";
import type { AppRequestScope } from "../types";

export function registerAuthRoutes(input: {
  app: Hono<{ Bindings: Env }>;
  authHandler: (
    request: Request,
    env: Env,
    authInput?: { getAppAuth: AppRequestScope["getAppAuth"] },
  ) => Promise<Response> | Response;
  createRequestScope: () => AppRequestScope;
  env: Env;
  getPrincipal: (
    request: Request,
    env: Env,
    authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
  ) => Promise<import("../../modules/auth").ResolvedAppPrincipal | null>;
}) {
  input.app.all("/api/auth/*", async (c) => {
    const scope = input.createRequestScope();

    try {
      return withNoStore(
        await input.authHandler(c.req.raw, input.env, {
          getAppAuth: scope.getAppAuth,
        }),
      );
    } catch {
      return dependencyNotReadyResponse();
    }
  });

  input.app.get("/api/me", async (c) => {
    const scope = input.createRequestScope();
    const resolved = await requireSessionPrincipal({
      env: input.env,
      getPrincipal: input.getPrincipal,
      request: c.req.raw,
      scope,
    });
    if (resolved.response) {
      return resolved.response;
    }

    return jsonResponse({
      principal: resolved.principal.principal,
      session: resolved.principal.session,
      permissions: resolved.principal.permissions,
    });
  });
}
