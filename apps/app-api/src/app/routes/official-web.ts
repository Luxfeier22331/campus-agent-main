import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse } from "../../http";
import {
  resolveOfficialWebCollectorPrincipal,
  type ResolvedAppPrincipal,
} from "../../modules/auth";
import type { OfficialWebPlannerService } from "../../modules/official-web-planner";
import { requireOperatorPrincipal } from "../principal";
import { serviceCredentialRequiredResponse } from "../responses";
import { parseLimit, readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerOfficialWebRoutes(input: {
  app: Hono<{ Bindings: Env }>;
  createRequestScope: () => AppRequestScope;
  env: Env;
  getPrincipal: (
    request: Request,
    env: Env,
    authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
  ) => Promise<ResolvedAppPrincipal | null>;
  officialWebPlannerService: OfficialWebPlannerService;
}) {
  input.app.post("/api/official-web/runs", async (c) => {
    const scope = input.createRequestScope();
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, input.env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    const response = await scope.resolveOfficialWebCommandService().start({
      payload: await readJsonRequestBody(c.req.raw),
      principal,
    });

    return jsonResponse(response);
  });

  input.app.post("/api/official-web/runs/:runId/heartbeats", async (c) => {
    const scope = input.createRequestScope();
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, input.env);
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

  input.app.post("/api/official-web/runs/:runId/finalize", async (c) => {
    const scope = input.createRequestScope();
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, input.env);
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

  input.app.post("/api/official-web/plans:resolve", async (c) => {
    const principal = await resolveOfficialWebCollectorPrincipal(c.req.raw, input.env);
    if (!principal) {
      return serviceCredentialRequiredResponse();
    }

    return jsonResponse(
      await input.officialWebPlannerService.resolve({
        payload: await readJsonRequestBody(c.req.raw),
        principal,
      }),
    );
  });

  input.app.get("/api/operator/official-web/sites", async (c) => {
    const scope = input.createRequestScope();
    const resolved = await requireOperatorPrincipal({
      env: input.env,
      getPrincipal: input.getPrincipal,
      request: c.req.raw,
      scope,
    });
    if (resolved.response) {
      return resolved.response;
    }

    return jsonResponse(
      await scope.resolveOfficialWebQueryService().listSites({
        principal: resolved.principal,
      }),
    );
  });

  input.app.get("/api/operator/official-web/sites/:siteId", async (c) => {
    const scope = input.createRequestScope();
    const resolved = await requireOperatorPrincipal({
      env: input.env,
      getPrincipal: input.getPrincipal,
      request: c.req.raw,
      scope,
    });
    if (resolved.response) {
      return resolved.response;
    }

    return jsonResponse(
      await scope.resolveOfficialWebQueryService().getSiteById({
        principal: resolved.principal,
        siteId: c.req.param("siteId"),
      }),
    );
  });

  input.app.get("/api/operator/official-web/runs", async (c) => {
    const scope = input.createRequestScope();
    const resolved = await requireOperatorPrincipal({
      env: input.env,
      getPrincipal: input.getPrincipal,
      request: c.req.raw,
      scope,
    });
    if (resolved.response) {
      return resolved.response;
    }

    return jsonResponse(
      await scope.resolveOfficialWebQueryService().listRuns({
        filters: {
          cursor: c.req.query("cursor") ?? null,
          ingestionDispatchStatus: c.req.query("ingestionDispatchStatus") ?? null,
          limit: parseLimit(c.req.query("limit")),
          runIntent: c.req.query("runIntent") ?? null,
          siteId: c.req.query("siteId") ?? null,
          startedAfter: c.req.query("startedAfter") ?? null,
          startedBefore: c.req.query("startedBefore") ?? null,
          status: c.req.query("status") ?? null,
        },
        principal: resolved.principal,
      }),
    );
  });

  input.app.get("/api/operator/official-web/runs/:runId", async (c) => {
    const scope = input.createRequestScope();
    const resolved = await requireOperatorPrincipal({
      env: input.env,
      getPrincipal: input.getPrincipal,
      request: c.req.raw,
      scope,
    });
    if (resolved.response) {
      return resolved.response;
    }

    return jsonResponse({
      run: await scope.resolveOfficialWebQueryService().getRunById({
        principal: resolved.principal,
        runId: c.req.param("runId"),
      }),
    });
  });
}
