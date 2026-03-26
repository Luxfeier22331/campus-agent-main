import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import wranglerConfig from "../wrangler.toml?raw";

describe("public-entry worker scaffold", () => {
  it("closes workers.dev and preview urls in config", () => {
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toMatch(/routes?\s*=/);
  });

  it("rejects authenticated-only requests without access jwt", async () => {
    const response = await worker.fetch(
      new Request("https://answer.example.com/api/v1/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_goal: "library hours" }),
      }),
      {
        ORIGIN_BASE_URL: "https://supervisor.internal",
        ORIGIN_SHARED_SECRET: "shared-secret",
        ENTRY_MODE: "authenticated-only",
        ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "audience",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Missing Access JWT.");
  });

  it("rejects authenticated-only when access config is missing", async () => {
    const response = await worker.fetch(
      new Request("https://answer.example.com/api/v1/answer", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-access-jwt-assertion": "token",
        },
        body: JSON.stringify({ user_goal: "library hours" }),
      }),
      {
        ORIGIN_BASE_URL: "https://supervisor.internal",
        ORIGIN_SHARED_SECRET: "shared-secret",
        ENTRY_MODE: "authenticated-only",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Missing Access configuration.");
  });

  it("rejects anonymous-enabled mode unless flag is true", async () => {
    const response = await worker.fetch(
      new Request("https://answer.example.com/api/v1/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_goal: "library hours" }),
      }),
      {
        ORIGIN_BASE_URL: "https://supervisor.internal",
        ORIGIN_SHARED_SECRET: "shared-secret",
        ENTRY_MODE: "anonymous-enabled",
        WORKER_ALLOW_ANONYMOUS: "false",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Anonymous entry is disabled.");
  });

  it("forwards only allowlisted headers to the trusted origin", async () => {
    const originalFetch = globalThis.fetch;
    const forwardedRequests: Request[] = [];
    const accessTeamDomain = "https://team.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "worker-test-key";
    const token = await new SignJWT({ sub: "student-001" })
      .setProtectedHeader({ alg: "ES256", kid: "worker-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    globalThis.fetch = (async (request: Request | URL | string) => {
      const forwarded = request instanceof Request ? request : new Request(request);
      if (forwarded.url === certsUrl) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      forwardedRequests.push(forwarded);
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://answer.example.com/api/v1/answer", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "x-trace-id": "trace-001",
            "x-actor-id": "spoofed-user",
            "cf-access-jwt-assertion": token,
          },
          body: JSON.stringify({ user_goal: "library hours" }),
        }),
        {
          ORIGIN_BASE_URL: "https://supervisor.internal",
          ORIGIN_SHARED_SECRET: "shared-secret",
          ENTRY_MODE: "authenticated-only",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          ACCESS_POLICY_AUD: "audience",
        },
      );

      expect(response.status).toBe(200);
      expect(forwardedRequests).toHaveLength(1);
      expect(forwardedRequests[0].url).toBe("https://supervisor.internal/api/v1/answer");
      expect(forwardedRequests[0].headers.get("x-worker-origin-auth")).toBe("shared-secret");
      expect(forwardedRequests[0].headers.get("x-trace-id")).toBe("trace-001");
      expect(forwardedRequests[0].headers.get("content-type")).toBe("application/json");
      expect(forwardedRequests[0].headers.get("accept")).toBe("application/json");
      expect(forwardedRequests[0].headers.get("cf-access-jwt-assertion")).toBe(token);
      expect(forwardedRequests[0].headers.get("x-actor-id")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
