import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse } from "../../http";
import {
  hasMatchingInternalSecret,
  hasTrustedInternalRequest,
} from "../../modules/auth";
import type { OfficialWebExecutionStatusService } from "../../modules/official-web-execution";
import { internalAuthRequiredResponse, serviceCredentialRequiredResponse } from "../responses";
import { readJsonRequestBody } from "../request-utils";
import type { AppRequestScope } from "../types";

export function registerInternalRoutes(input: {
  app: Hono<{ Bindings: Env }>;
  createRequestScope: () => AppRequestScope;
  env: Env;
  officialWebExecutionStatusService: OfficialWebExecutionStatusService;
}) {
  input.app.post("/api/internal/operator/quality/grades", async (c) => {
    const scope = input.createRequestScope();
    if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
      return serviceCredentialRequiredResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorObservabilityCommandService().ingestGrades({
        payload: await readJsonRequestBody(c.req.raw),
      }),
    );
  });

  input.app.post("/api/internal/official-web/runs/:runId/ingestion-execution", async (c) => {
    if (!hasTrustedInternalRequest(c.req.raw, input.env)) {
      return internalAuthRequiredResponse();
    }

    return jsonResponse(
      await input.officialWebExecutionStatusService.updateRunExecutionStatus({
        payload: await readJsonRequestBody(c.req.raw),
        runId: c.req.param("runId"),
      }),
    );
  });

  input.app.post("/api/internal/operator/trace-backlinks", async (c) => {
    const scope = input.createRequestScope();
    if (!hasMatchingInternalSecret(c.req.raw, input.env)) {
      return serviceCredentialRequiredResponse();
    }

    return jsonResponse(
      await scope.resolveOperatorObservabilityCommandService().ingestTraceBacklinks({
        payload: await readJsonRequestBody(c.req.raw),
      }),
    );
  });
}
