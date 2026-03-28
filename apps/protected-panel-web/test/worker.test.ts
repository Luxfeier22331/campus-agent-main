import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

describe("protected panel web worker shell", () => {
  it("closes workers.dev and preview urls in config", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toMatch(/routes?\s*=/);
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://panel.example.com/healthz"),
      {
        PANEL_APP_NAME: "campus-agent-v2-protected-panel",
        PANEL_RUNTIME_API_BASE_URL: "https://supervisor.internal",
        PANEL_PROTECTED_HOSTNAME: "panel.example.com",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
      },
    );
    const ready = await worker.fetch(
      new Request("https://panel.example.com/readyz"),
      {
        PANEL_APP_NAME: "campus-agent-v2-protected-panel",
        PANEL_RUNTIME_API_BASE_URL: "https://supervisor.internal",
        PANEL_PROTECTED_HOSTNAME: "panel.example.com",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
      },
    );

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      app_name: "campus-agent-v2-protected-panel",
      surface: "protected-panel-web",
      runtime: "cloudflare-worker",
    });

    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      runtime_api_base_url: "https://supervisor.internal",
      protected_hostname: "panel.example.com",
      protection_envelope: "cloudflare-access",
      runtime: "cloudflare-worker",
    });
  });

  it("serves the protected app shell from static assets after operator admission", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-panel-shell.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    globalThis.fetch = (async (request: Request | URL | string) => {
      const inbound = request instanceof Request ? request : new Request(request);
      if (inbound.url === certsUrl) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call: ${inbound.url}`);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://panel.example.com/requests", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          ASSETS: {
            fetch: async () =>
              new Response("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                },
                status: 200,
              }),
          },
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
          PANEL_PROTECTED_HOSTNAME: "panel.example.com",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      await expect(response.text()).resolves.toContain("<div id=\"root\"></div>");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when frontend assets are not configured for the protected shell", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/"),
      {
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        PANEL_PROTECTED_HOSTNAME: "panel.example.com",
        PANEL_PROTECTION_ENVELOPE: "required",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "frontend_assets_not_ready",
        message: "Protected panel frontend assets are not configured.",
      },
    });
  });

  it("returns a first-pass overview api projection and marks blocked domains explicitly", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/api/overview"),
      {
        PANEL_APP_NAME: "campus-agent-v2-protected-panel",
        PANEL_RUNTIME_API_BASE_URL: "https://supervisor.internal",
        PANEL_PROTECTED_HOSTNAME: "panel.example.com",
        PANEL_PROTECTION_ENVELOPE: "required",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      app_name: "campus-agent-v2-protected-panel",
      surface: "protected-panel-web",
      runtime: "cloudflare-worker",
      protected_hostname: "panel.example.com",
      protection_envelope: "required",
      runtime_api_base_url: "https://supervisor.internal",
      panel_domains: {
        overview: "ready",
        requests: "ready",
        jobs: "blocked",
        operations: "deferred",
        audit: "blocked",
      },
    });
  });

  it("rejects protected overview requests without access jwt when cloudflare access is required", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/api/overview"),
      {
        PANEL_RUNTIME_API_BASE_URL: "https://supervisor.internal",
        PANEL_PROTECTED_HOSTNAME: "panel.example.com",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "panel-audience",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Missing Access JWT.");
  });

  it("allows protected overview requests with a valid access jwt and exposes minimal operator context", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-requests-list.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ sub: "operator-001", email: "ops@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    globalThis.fetch = (async (request: Request | URL | string) => {
      const inbound = request instanceof Request ? request : new Request(request);
      if (inbound.url === certsUrl) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call: ${inbound.url}`);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://panel.example.com/api/overview", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          PANEL_APP_NAME: "campus-agent-v2-protected-panel",
          PANEL_RUNTIME_API_BASE_URL: "https://supervisor.internal",
          PANEL_PROTECTED_HOSTNAME: "panel.example.com",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          ACCESS_POLICY_AUD: "panel-audience",
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "ok",
        app_name: "campus-agent-v2-protected-panel",
        surface: "protected-panel-web",
        runtime: "cloudflare-worker",
        protected_hostname: "panel.example.com",
        protection_envelope: "cloudflare-access",
        runtime_api_base_url: "https://supervisor.internal",
        panel_domains: {
          overview: "ready",
          requests: "ready",
          jobs: "blocked",
          operations: "deferred",
          audit: "blocked",
        },
        operator_context: {
          display_name: null,
          email: "ops@example.com",
          groups: [],
          operator_id: "ops@example.com",
          principal_class: "human",
          subject: "operator-001",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies request list queries to app-api with trusted operator headers", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-requests-detail.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({
      email: "ops@example.com",
      groups: ["panel", "ops"],
      name: "Ops Team",
      sub: "operator-001",
    })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    let forwardedOperatorEmail: string | null = null;
    let forwardedOperatorGroups: string | null = null;
    let forwardedOperatorId: string | null = null;
    let forwardedOperatorName: string | null = null;
    let forwardedUrl: string | null = null;

    globalThis.fetch = (async (request: Request | URL | string) => {
      const inbound = request instanceof Request ? request : new Request(request);
      if (inbound.url === certsUrl) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call: ${inbound.url}`);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://panel.example.com/api/requests?status=completed", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async (request: Request) => {
              forwardedUrl = request.url;
              forwardedOperatorEmail = request.headers.get("x-app-operator-email");
              forwardedOperatorGroups = request.headers.get("x-app-operator-groups");
              forwardedOperatorId = request.headers.get("x-app-operator-id");
              forwardedOperatorName = request.headers.get("x-app-operator-name");

              return new Response(
                JSON.stringify({
                  page: {
                    nextCursor: null,
                  },
                  requests: [
                    {
                      requestId: "req_01HQ",
                      status: "completed",
                    },
                  ],
                }),
                {
                  headers: {
                    "content-type": "application/json; charset=utf-8",
                  },
                  status: 200,
                },
              );
            },
          },
          PANEL_APP_NAME: "campus-agent-v2-protected-panel",
          PANEL_PROTECTED_HOSTNAME: "panel.example.com",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        page: {
          nextCursor: null,
        },
        requests: [
          {
            requestId: "req_01HQ",
            status: "completed",
          },
        ],
      });
      expect(forwardedUrl).not.toBeNull();
      expect(forwardedUrl).toBe(
        "https://app-api.internal/api/operator/requests?status=completed",
      );
      expect(forwardedOperatorEmail).toBe("ops@example.com");
      expect(forwardedOperatorId).toBe("ops@example.com");
      expect(forwardedOperatorName).toBe("Ops Team");
      expect(forwardedOperatorGroups).toBe("panel,ops");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies request detail queries to app-api and fails closed without an app-api binding", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    globalThis.fetch = (async (request: Request | URL | string) => {
      const inbound = request instanceof Request ? request : new Request(request);
      if (inbound.url === certsUrl) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call: ${inbound.url}`);
    }) as typeof fetch;

    try {
      const ok = await worker.fetch(
        new Request("https://panel.example.com/api/requests/req_01HQ", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async () =>
              new Response(JSON.stringify({ request: { requestId: "req_01HQ" } }), {
                headers: {
                  "content-type": "application/json; charset=utf-8",
                },
                status: 200,
              }),
          },
          PANEL_PROTECTED_HOSTNAME: "panel.example.com",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(ok.status).toBe(200);
      await expect(ok.json()).resolves.toEqual({
        request: {
          requestId: "req_01HQ",
        },
      });

      const missingBinding = await worker.fetch(
        new Request("https://panel.example.com/api/requests/req_01HQ", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          PANEL_PROTECTED_HOSTNAME: "panel.example.com",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(missingBinding.status).toBe(503);
      await expect(missingBinding.json()).resolves.toEqual({
        error: {
          code: "dependency_not_ready",
          message: "App API binding is not configured.",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
