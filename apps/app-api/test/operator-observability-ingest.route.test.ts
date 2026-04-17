// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
  APP_API_NAME: "campus-agent-app-api",
  APP_API_ENVIRONMENT: "test" as const,
  APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
  BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
  PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
  SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
  SUPERVISOR_API_SHARED_SECRET: "shared-secret",
  APP_API_DB: {
    connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
  },
};

describe("operator observability internal ingest routes", () => {
  it("accepts sampled grades through the internal ingest seam", async () => {
    const service = {
      ingestGrades: vi.fn().mockResolvedValue({ accepted: 1 }),
      ingestTraceBacklinks: vi.fn(),
    };
    const app = createApp(env as never, {
      operatorObservabilityCommandService: service as never,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/internal/operator/quality/grades", {
        body: JSON.stringify({
          grades: [
            {
              gradeDomain: "grounding",
              gradeSource: "openai_trace_grader",
              graderVersion: "grader@2026-04-03",
              rationaleSummary: "grounded to cited handbook passages",
              requestId: "req_01HQ",
              sampledAt: "2026-04-03T00:10:00.000Z",
              score: 0.913,
              traceId: "trace_01HQ",
              verdict: "pass",
            },
          ],
        }),
        headers: {
          "content-type": "application/json",
          "x-app-internal-auth": "trusted-secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
    expect(service.ingestGrades).toHaveBeenCalledWith({
      payload: {
        grades: [
          {
            gradeDomain: "grounding",
            gradeSource: "openai_trace_grader",
            graderVersion: "grader@2026-04-03",
            rationaleSummary: "grounded to cited handbook passages",
            requestId: "req_01HQ",
            sampledAt: "2026-04-03T00:10:00.000Z",
            score: 0.913,
            traceId: "trace_01HQ",
            verdict: "pass",
          },
        ],
      },
    });
  });

  it("accepts trace backlinks through the internal ingest seam", async () => {
    const service = {
      ingestGrades: vi.fn(),
      ingestTraceBacklinks: vi.fn().mockResolvedValue({ accepted: 1 }),
    };
    const app = createApp(env as never, {
      operatorObservabilityCommandService: service as never,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/internal/operator/trace-backlinks", {
        body: JSON.stringify({
          backlinks: [
            {
              issueFingerprint: "timeout:supervisor-api",
              issueLink: "https://sentry.example/issues/123",
              requestId: "req_01HQ",
              traceId: "trace_01HQ",
              traceLink: "https://sentry.example/traces/trace_01HQ",
            },
          ],
        }),
        headers: {
          "content-type": "application/json",
          "x-app-internal-auth": "trusted-secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
    expect(service.ingestTraceBacklinks).toHaveBeenCalledWith({
      payload: {
        backlinks: [
          {
            issueFingerprint: "timeout:supervisor-api",
            issueLink: "https://sentry.example/issues/123",
            requestId: "req_01HQ",
            traceId: "trace_01HQ",
            traceLink: "https://sentry.example/traces/trace_01HQ",
          },
        ],
      },
    });
  });

  it("fails closed when the internal shared secret is missing", async () => {
    const service = {
      ingestGrades: vi.fn(),
      ingestTraceBacklinks: vi.fn(),
    };
    const app = createApp(env as never, {
      operatorObservabilityCommandService: service as never,
    });

    const response = await app.fetch(
      new Request("https://app-api.internal/api/internal/operator/quality/grades", {
        body: JSON.stringify({ grades: [] }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "service_credential_required",
        details: null,
        message: "Collector service credential required.",
        requestId: null,
        retryable: false,
        traceId: null,
      },
    });
    expect(service.ingestGrades).not.toHaveBeenCalled();
  });
});
