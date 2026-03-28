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

  it("keeps the root route fail-closed until operator admission and api inventory are wired", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/"),
      {
        PANEL_RUNTIME_API_BASE_URL: "https://supervisor.internal",
        PANEL_PROTECTED_HOSTNAME: "panel.example.com",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "protected_surface_required",
        message:
          "Protected panel stays fail-closed until an outer protected access envelope and panel-facing runtime API inventory are configured.",
      },
      runtime_api_base_url: "https://supervisor.internal",
      protected_hostname: "panel.example.com",
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
        requests: "blocked",
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
    const accessTeamDomain = "https://team.cloudflareaccess.com";
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
          requests: "blocked",
          jobs: "blocked",
          operations: "deferred",
          audit: "blocked",
        },
        operator_context: {
          operator_id: "ops@example.com",
          principal_class: "human",
          subject: "operator-001",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
