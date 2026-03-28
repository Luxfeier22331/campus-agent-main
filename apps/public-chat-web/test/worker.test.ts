import { describe, expect, it } from "vitest";

import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

describe("public chat web worker shell", () => {
  it("closes workers.dev and preview urls in config", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toMatch(/routes?\s*=/);
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://chat.example.com/healthz"),
      {
        APP_API_BASE_URL: "https://app-api.internal",
        PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );
    const ready = await worker.fetch(
      new Request("https://chat.example.com/readyz"),
      {
        APP_API_BASE_URL: "https://app-api.internal",
        PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      app_name: "campus-agent-public-chat-web",
      surface: "public-chat-web",
      runtime: "cloudflare-worker",
    });

    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      app_api_base_url: "https://app-api.internal",
      public_hostname: "chat.example.com",
      runtime: "cloudflare-worker",
    });
  });

  it("keeps the root route as a placeholder until the forward ui is mounted", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/"),
      {
        APP_API_BASE_URL: "https://app-api.internal",
        PUBLIC_CHAT_HOSTNAME: "chat.example.com",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "public_surface_placeholder",
        message:
          "Public chat web keeps the root route as a placeholder until the forward UI shell is mounted here.",
      },
    });
  });

  it("proxies same-site api requests to app-api and forwards auth/body headers only", async () => {
    let forwardedBody: string | null = null;
    let forwardedCookie: string | null = null;
    let forwardedIdempotencyKey: string | null = null;
    let forwardedTraceId: string | null = null;
    let forwardedUrl: string | null = null;

    const response = await worker.fetch(
      new Request("https://chat.example.com/api/chat/requests", {
        method: "POST",
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=test",
          "content-type": "application/json",
          "idempotency-key": "idem-001",
          "x-spoofed-header": "drop-me",
          "x-trace-id": "trace-001",
        },
        body: JSON.stringify({
          conversationId: "conv_01HQ",
          prompt: "图书馆开放到几点？",
        }),
      }),
      {
        APP_API: {
          fetch: async (request: Request) => {
            forwardedBody = await request.text();
            forwardedCookie = request.headers.get("cookie");
            forwardedIdempotencyKey = request.headers.get("idempotency-key");
            forwardedTraceId = request.headers.get("x-trace-id");
            forwardedUrl = request.url;

            return new Response(
              JSON.stringify({
                answer: {
                  result: {
                    kind: "answer",
                    requestId: "req_01HQ",
                  },
                },
              }),
              {
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  "x-request-id": "req_01HQ",
                },
                status: 200,
              },
            );
          },
        },
        APP_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_01HQ");
    await expect(response.json()).resolves.toEqual({
      answer: {
        result: {
          kind: "answer",
          requestId: "req_01HQ",
        },
      },
    });
    expect(forwardedUrl).toBe("https://app-api.internal/api/chat/requests");
    expect(forwardedCookie).toBe("better-auth.session_token=test");
    expect(forwardedIdempotencyKey).toBe("idem-001");
    expect(forwardedTraceId).toBe("trace-001");
    expect(forwardedBody).toBe(
      JSON.stringify({
        conversationId: "conv_01HQ",
        prompt: "图书馆开放到几点？",
      }),
    );
  });

  it("fails closed when app-api binding is missing", async () => {
    const response = await worker.fetch(
      new Request("https://chat.example.com/api/me"),
      {
        APP_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        message: "App API binding is not configured.",
      },
    });
  });
});
