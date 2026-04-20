import "./data-provider.test";
import "./audit-domain.test";
import "./cost-domain.test";
import "./overview-domain.test";
import "./panel-shell-copy-regression.test";
import "./quality-domain.test";
import "./safety-domain.test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import { createApp as createAppApi } from "../../app-api/src/app";
import type { OperatorQueryService } from "../../app-api/src/modules/operator-query";
import packageManifestRaw from "../package.json?raw";
import deployStagingSource from "../scripts/deploy-staging.mjs?raw";
import worker from "../src/index";
import viteConfigSource from "../vite.config.ts?raw";
import wranglerConfig from "../wrangler.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
  dependencies?: Record<string, string | undefined>;
  scripts?: Record<string, string | undefined>;
};

function createOperatorQueryServiceMock(
  overrides: Partial<OperatorQueryService> = {},
): OperatorQueryService {
  return {
    getById: vi.fn(),
    getObservabilityById: vi.fn(),
    getAuditById: vi.fn(),
    getOverview: vi.fn(),
    getQualitySummary: vi.fn(),
    getQualityTimeseries: vi.fn(),
    getSafetySummary: vi.fn(),
    listSafetyAnomalies: vi.fn(),
    getCostSummary: vi.fn(),
    getCostTimeseries: vi.fn(),
    list: vi.fn().mockResolvedValue({
      page: {
        nextCursor: null,
      },
      requests: [],
    }),
    listAudit: vi.fn(),
    listQualityBadcases: vi.fn(),
    ...overrides,
  };
}

describe("protected panel web worker shell", () => {
  it("declares the staging custom domain, app-api staging binding, and deploy gates", () => {
    expect(packageManifest.dependencies?.["@mui/x-charts"]).toBeTruthy();
    expect(wranglerConfig).toContain("workers_dev = false");
    expect(wranglerConfig).toContain("preview_urls = false");
    expect(wranglerConfig).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(wranglerConfig).toContain("[[env.staging.routes]]");
    expect(wranglerConfig).toContain('pattern = "campus-panel-staging.ayafeed.com"');
    expect(wranglerConfig).toContain("custom_domain = true");
    expect(wranglerConfig).toContain("[env.local.vars]");
    expect(wranglerConfig).toContain('PANEL_RUNTIME_API_BASE_URL = "https://app-api.internal"');
    expect(wranglerConfig).toContain('ACCESS_TEAM_DOMAIN = "http://127.0.0.1:9798"');
    expect(wranglerConfig).toContain('ACCESS_POLICY_AUD = "panel-local-smoke"');
    expect(wranglerConfig).toContain("[[env.local.services]]");
    expect(wranglerConfig).toContain('environment = "local"');
    expect(wranglerConfig).toContain("[env.local.secrets]");
    expect(wranglerConfig).toContain("[[env.staging.services]]");
    expect(wranglerConfig).toContain('binding = "APP_API"');
    expect(wranglerConfig).toContain('service = "app-api-staging"');
    expect(wranglerConfig).toContain("[env.staging.vars]");
    const stagingVarsBlock = wranglerConfig.split("[env.staging.vars]")[1] ?? "";
    expect(stagingVarsBlock).toContain(
      'PANEL_RUNTIME_API_BASE_URL = "https://campus-api-staging.ayafeed.com"',
    );
    expect(stagingVarsBlock).toContain('PANEL_PROTECTION_ENVELOPE = "cloudflare-access"');
    expect(stagingVarsBlock).not.toContain("ACCESS_TEAM_DOMAIN");
    expect(stagingVarsBlock).not.toContain("ACCESS_POLICY_AUD");
    expect(stagingVarsBlock).toContain('SENTRY_ENVIRONMENT = "staging"');
    expect(stagingVarsBlock).not.toContain("SENTRY_RELEASE = ");
    expect(deployStagingSource).toContain("SENTRY_RELEASE:");
    expect(deployStagingSource).toContain("resolveStagingSentryRelease");
    expect(packageManifest.scripts?.["build:staging"]).toContain("CLOUDFLARE_ENV=staging");
    expect(packageManifest.scripts?.dev).toContain("CLOUDFLARE_ENV=local");
    expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("PANEL_LIVE_SMOKE=1");
    expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--port 5174");
    expect(packageManifest.scripts?.["dev:live-smoke"]).not.toContain("CLOUDFLARE_ENV=local");
    expect(viteConfigSource).toContain("auxiliaryWorkers");
    expect(viteConfigSource).toContain("wrangler.local-smoke.toml");
    expect(viteConfigSource).toContain("../app-api/wrangler.local-smoke.toml");
    expect(packageManifest.scripts?.deploy).not.toContain("XDG_CONFIG_HOME=./.wrangler-home");
    expect(packageManifest.scripts?.deploy).toContain("run-wrangler-command.mjs");
    expect(packageManifest.scripts?.["deploy:staging"]).toContain("deploy-staging.mjs");
    expect(packageManifest.scripts?.["deploy:staging"]).toContain("pnpm deploy:preflight:staging");
    expect(packageManifest.scripts?.["deploy:preflight:staging"]).toContain(
      "run-worker-staging-preflight.mjs",
    );
    expect(packageManifest.scripts?.["deploy:check-secrets:staging"]).toContain(
      "check_worker_secret_presence.py",
    );
    expect(deployStagingSource).toContain("buildWranglerCommandEnv");
    expect(packageManifest.scripts?.["deploy:staging"]).not.toContain(
      "XDG_CONFIG_HOME=./.wrangler-home",
    );
    expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
      "verify-worker-deploy-config.mjs",
    );
    expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
      "dist/protected_panel_web/wrangler.json",
    );
    expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
      "SERVICE:APP_API=app-api-staging",
    );
    expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
      "VAR_ABSENT:SENTRY_RELEASE",
    );
    expect(packageManifest.scripts?.["deploy:verify-config:staging"]).toContain(
      "ROUTE:campus-panel-staging.ayafeed.com",
    );
  });

  it("declares required secrets for local and staging worker environments", () => {
    expect(wranglerConfig).toContain("[secrets]");
    expect(wranglerConfig).toContain('required = ["PANEL_APP_API_SHARED_SECRET"]');
    expect(wranglerConfig).toContain("[env.staging.secrets]");
    expect(wranglerConfig).toContain('"PANEL_APP_API_SHARED_SECRET"');
    expect(wranglerConfig).toContain('"SENTRY_DSN"');
  });

  it("serves healthz and readyz from the worker shell", async () => {
    const health = await worker.fetch(
      new Request("https://panel.example.com/healthz"),
      {
        APP_API: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: "ready",
                dependencies: {
                  auth: "ready",
                  database: "ready",
                  officialWebHandoff: "not_configured",
                  operatorBridge: "configured",
                  publicChatOrigin: "configured",
                  supervisorApi: "ready",
                },
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
        },
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PANEL_APP_NAME: "campus-agent-v2-protected-panel",
        PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        ACCESS_TEAM_DOMAIN: "https://team-readyz.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "panel-readyz-audience",
      },
    );
    const ready = await worker.fetch(
      new Request("https://panel.example.com/readyz"),
      {
        APP_API: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: "ready",
                dependencies: {
                  auth: "ready",
                  database: "ready",
                  officialWebHandoff: "not_configured",
                  operatorBridge: "configured",
                  publicChatOrigin: "configured",
                  supervisorApi: "ready",
                },
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
        },
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PANEL_APP_NAME: "campus-agent-v2-protected-panel",
        PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        ACCESS_TEAM_DOMAIN: "https://team-readyz.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "panel-readyz-audience",
      },
    );

    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      app_name: "campus-agent-v2-protected-panel",
      surface: "protected-panel-web",
      runtime: "cloudflare-worker",
    });

    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      dependencies: {
        accessOriginAdmission: "configured",
        appApiBinding: "configured",
        appApiRuntime: "ready",
        assets: "configured",
        operatorBridge: "configured",
      },
      runtime_api_base_url: "https://app-api.internal",
      protected_hostname: "panel.example.com",
      protection_envelope: "cloudflare-access",
      runtime: "cloudflare-worker",
    });
  });

  it("fails readyz closed when protected runtime dependencies are missing", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/readyz"),
      {
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          missing: [
            "APP_API binding",
            "ASSETS binding",
            "PANEL_RUNTIME_API_BASE_URL",
            "PANEL_APP_API_SHARED_SECRET",
            "ACCESS_TEAM_DOMAIN",
            "ACCESS_POLICY_AUD",
          ],
        },
        message: "Runtime configuration is incomplete.",
      },
    });
  });

  it("fails readyz closed when cloudflare access admission is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/readyz"),
      {
        APP_API: {
          fetch: async () => new Response(null, { status: 204 }),
        },
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          missing: [
            "PANEL_PROTECTION_ENVELOPE=cloudflare-access",
            "ACCESS_TEAM_DOMAIN",
            "ACCESS_POLICY_AUD",
          ],
        },
        message: "Runtime configuration is incomplete.",
      },
    });
  });

  it("fails readyz closed when staging still uses placeholder access values", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/readyz"),
      {
        APP_API: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "panel-audience",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          missing: ["ACCESS_TEAM_DOMAIN", "ACCESS_POLICY_AUD"],
        },
        message: "Runtime configuration is incomplete.",
      },
    });
  });

  it("fails readyz closed when the shared app-api runtime is not ready", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/readyz"),
      {
        APP_API: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                error: {
                  code: "dependency_not_ready",
                  message: "Runtime dependencies are not ready.",
                },
              }),
              {
                status: 503,
                headers: {
                  "content-type": "application/json",
                },
              },
            ),
        },
        ASSETS: {
          fetch: async () => new Response("ok", { status: 200 }),
        },
        PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        ACCESS_TEAM_DOMAIN: "https://team-readyz.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "panel-readyz-audience",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          appApiRuntime: "app-api readyz returned 503",
        },
        message: "Runtime configuration is incomplete.",
      },
    });
  });

  it("serves the protected app shell from static assets after operator admission and bridge readiness", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-panel-shell.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async () => new Response(null, { status: 204 }),
          },
          ASSETS: {
            fetch: async () =>
              new Response("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                },
                status: 200,
              }),
          },
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
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

  it("fails closed when the protected shell bridge is not configured", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-panel-bridge.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
          ACCESS_POLICY_AUD: "panel-operator-audience",
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
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "dependency_not_ready",
          message: "App API binding is not configured.",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when protected shell admission is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/"),
      {
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
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          missing: [
            "PANEL_PROTECTION_ENVELOPE=cloudflare-access",
            "ACCESS_TEAM_DOMAIN",
            "ACCESS_POLICY_AUD",
          ],
        },
        message: "Protected panel admission is not configured.",
      },
    });
  });

  it("fails closed when frontend assets are not configured for the protected shell", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-panel-assets.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
        new Request("https://panel.example.com/", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async () => new Response(null, { status: 204 }),
          },
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "frontend_assets_not_ready",
          message: "Protected panel frontend assets are not configured.",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when protected overview admission is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/api/overview"),
      {
        PANEL_APP_NAME: "campus-agent-v2-protected-panel",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "dependency_not_ready",
        details: {
          missing: [
            "PANEL_PROTECTION_ENVELOPE=cloudflare-access",
            "ACCESS_TEAM_DOMAIN",
            "ACCESS_POLICY_AUD",
          ],
        },
        message: "Protected panel admission is not configured.",
      },
    });
  });

  it("rejects protected overview requests without access jwt when cloudflare access is required", async () => {
    const response = await worker.fetch(
      new Request("https://panel.example.com/api/overview"),
      {
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        ACCESS_TEAM_DOMAIN: "https://team-overview-token.cloudflareaccess.com",
        ACCESS_POLICY_AUD: "panel-operator-audience",
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
      .setAudience("panel-operator-audience")
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
          APP_API: {
            fetch: async () => new Response(null, { status: 204 }),
          },
          PANEL_APP_NAME: "campus-agent-v2-protected-panel",
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          ACCESS_POLICY_AUD: "panel-operator-audience",
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
        runtime_api_base_url: "https://app-api.internal",
        panel_domains: {
          overview: "ready",
          requests: "ready",
          official_web: "ready",
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

  it("accepts a valid CF_Authorization cookie as an equivalent signed access assertion", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-overview-cookie.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ sub: "operator-001", email: "ops@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
            cookie: `CF_AppSession=session-id; theme=light; CF_Authorization=${token}`,
          },
        }),
        {
          APP_API: {
            fetch: async () => new Response(null, { status: 204 }),
          },
          PANEL_APP_NAME: "campus-agent-v2-protected-panel",
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          ACCESS_POLICY_AUD: "panel-operator-audience",
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
        runtime_api_base_url: "https://app-api.internal",
        panel_domains: {
          overview: "ready",
          requests: "ready",
          official_web: "ready",
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

  it("fails closed when protected overview bridge is not configured", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-overview-bridge.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ sub: "operator-001", email: "ops@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          ACCESS_POLICY_AUD: "panel-operator-audience",
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "dependency_not_ready",
          message: "App API binding is not configured.",
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
      .setAudience("panel-operator-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    let forwardedOperatorEmail: string | null = null;
    let forwardedOperatorId: string | null = null;
    let forwardedInternalAuth: string | null = null;
    let forwardedOperatorName: string | null = null;
    let forwardedBaggage: string | null = null;
    let forwardedSentryTrace: string | null = null;
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
            baggage: "sentry-environment=test",
            "cf-access-jwt-assertion": token,
            "sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async (request: Request) => {
              forwardedUrl = request.url;
              forwardedOperatorEmail = request.headers.get("x-app-operator-email");
              forwardedOperatorId = request.headers.get("x-app-operator-id");
              forwardedInternalAuth = request.headers.get("x-app-internal-auth");
              forwardedOperatorName = request.headers.get("x-app-operator-name");
              forwardedBaggage = request.headers.get("baggage");
              forwardedSentryTrace = request.headers.get("sentry-trace");

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
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
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
      expect(forwardedInternalAuth).toBe("panel-bridge-secret");
      expect(forwardedBaggage).toBe("sentry-environment=test");
      expect(forwardedSentryTrace).toBe(
        "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies request detail queries to app-api and fails closed without an app-api binding", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-request-detail.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
          ACCESS_POLICY_AUD: "panel-operator-audience",
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
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
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
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
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

  it("returns a contract-shaped dependency error when the app-api binding throws", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-request-throw.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
        new Request("https://panel.example.com/api/requests/req_01HQ", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async () => {
              throw new Error("service binding failure");
            },
          },
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "dependency_not_ready",
          details: null,
          message: "App API upstream is unavailable.",
          requestId: null,
          retryable: true,
          traceId: null,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies request observability detail queries to the app-api observability seam", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-observability.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

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
        new Request("https://panel.example.com/api/requests/req_01HQ/observability", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async (request: Request) => {
              forwardedUrl = request.url;
              return new Response(
                JSON.stringify({
                  request: {
                    requestId: "req_01HQ",
                  },
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
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        request: {
          requestId: "req_01HQ",
        },
      });
      expect(forwardedUrl).toBe(
        "https://app-api.internal/api/operator/requests/req_01HQ/observability",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies operator aggregate namespaces to app-api with the same trusted operator bridge", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-operator-aggregates.cloudflareaccess.com";
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
      .setAudience("panel-operator-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const forwardedUrls: string[] = [];
    const forwardedOperatorEmails: string[] = [];

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
      const workerEnv = {
        ACCESS_POLICY_AUD: "panel-operator-audience",
        ACCESS_TEAM_DOMAIN: accessTeamDomain,
        APP_API: {
          fetch: async (request: Request) => {
            const forwardedUrl = request.url;
            forwardedUrls.push(forwardedUrl);
            forwardedOperatorEmails.push(request.headers.get("x-app-operator-email") ?? "");

            const pathname = new URL(forwardedUrl).pathname;
            if (pathname === "/api/operator/quality/summary") {
              return new Response(
                JSON.stringify({
                  asOf: "2026-03-28T08:00:10.000Z",
                  runtime: {
                    citationMissRate: { count: 1, eligibleCount: 4, value: 0.25 },
                    emptyRecallRate: { count: 0, eligibleCount: 4, value: 0 },
                    requestCount: 4,
                    refusalDistribution: {
                      approvalRequired: 0,
                      needsClarification: 0,
                      noAnswer: 0,
                      rejected: 0,
                    },
                  },
                  sampledGrades: null,
                  window: {
                    from: "2026-03-27T08:00:10.000Z",
                    granularity: "1h",
                    to: "2026-03-28T08:00:10.000Z",
                  },
                }),
                {
                  headers: {
                    "content-type": "application/json; charset=utf-8",
                  },
                  status: 200,
                },
              );
            }

            if (pathname === "/api/operator/cost/timeseries") {
              return new Response(
                JSON.stringify({
                  asOf: "2026-03-28T08:00:10.000Z",
                  series: [
                    {
                      bucketEnd: "2026-03-28T08:00:00.000Z",
                      bucketStart: "2026-03-28T07:00:00.000Z",
                      cachedInputTokens: 0,
                      estimatedCostMicrousd: 3810,
                      inputTokens: 812,
                      outputTokens: 229,
                    },
                  ],
                  window: {
                    from: "2026-03-27T08:00:10.000Z",
                    granularity: "1h",
                    to: "2026-03-28T08:00:10.000Z",
                  },
                }),
                {
                  headers: {
                    "content-type": "application/json; charset=utf-8",
                  },
                  status: 200,
                },
              );
            }

            if (pathname === "/api/operator/audit") {
              return new Response(
                JSON.stringify({
                  events: [
                    {
                      auditEventId: "aevt_01HQ",
                      eventType: "request.completed",
                      occurredAt: "2026-03-28T08:00:01.000Z",
                      principalType: "campus_member",
                      requestId: "req_01HQ",
                      selectedTarget: "rag-specialist",
                      status: "completed",
                      summary: "Knowledge request completed via rag-specialist.",
                      surface: "public_chat_web",
                      traceId: "trace_01HQ",
                    },
                  ],
                  page: {
                    nextCursor: null,
                  },
                }),
                {
                  headers: {
                    "content-type": "application/json; charset=utf-8",
                  },
                  status: 200,
                },
              );
            }

            if (pathname === "/api/operator/audit/aevt_01HQ") {
              return new Response(
                JSON.stringify({
                  event: {
                    auditEventId: "aevt_01HQ",
                    requestId: "req_01HQ",
                  },
                  links: {
                    issueFingerprint: "projection-missing",
                    issueLink: "https://sentry.example/issues/789",
                    traceLink: "https://sentry.example/traces/trace_01HQ",
                  },
                }),
                {
                  headers: {
                    "content-type": "application/json; charset=utf-8",
                  },
                  status: 200,
                },
              );
            }

            throw new Error(`Unexpected proxied operator path: ${pathname}`);
          },
        },
        PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
        PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
        PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
      };

      const qualitySummaryResponse = await worker.fetch(
        new Request(
          "https://panel.example.com/api/operator/quality/summary?window=24h&surface=public_chat_web",
          {
            headers: {
              "cf-access-jwt-assertion": token,
            },
          },
        ),
        workerEnv,
      );
      expect(qualitySummaryResponse.status).toBe(200);
      await expect(qualitySummaryResponse.json()).resolves.toMatchObject({
        runtime: {
          requestCount: 4,
        },
      });

      const costTimeseriesResponse = await worker.fetch(
        new Request(
          "https://panel.example.com/api/operator/cost/timeseries?window=24h&granularity=1h",
          {
            headers: {
              "cf-access-jwt-assertion": token,
            },
          },
        ),
        workerEnv,
      );
      expect(costTimeseriesResponse.status).toBe(200);
      await expect(costTimeseriesResponse.json()).resolves.toMatchObject({
        series: [
          {
            estimatedCostMicrousd: 3810,
            inputTokens: 812,
            outputTokens: 229,
          },
        ],
      });

      const auditListResponse = await worker.fetch(
        new Request(
          "https://panel.example.com/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
          {
            headers: {
              "cf-access-jwt-assertion": token,
            },
          },
        ),
        workerEnv,
      );
      expect(auditListResponse.status).toBe(200);
      await expect(auditListResponse.json()).resolves.toMatchObject({
        events: [
          {
            auditEventId: "aevt_01HQ",
            eventType: "request.completed",
          },
        ],
      });

      const auditDetailResponse = await worker.fetch(
        new Request("https://panel.example.com/api/operator/audit/aevt_01HQ", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        workerEnv,
      );
      expect(auditDetailResponse.status).toBe(200);
      await expect(auditDetailResponse.json()).resolves.toMatchObject({
        event: {
          auditEventId: "aevt_01HQ",
        },
      });

      expect(forwardedUrls).toEqual([
        "https://app-api.internal/api/operator/quality/summary?window=24h&surface=public_chat_web",
        "https://app-api.internal/api/operator/cost/timeseries?window=24h&granularity=1h",
        "https://app-api.internal/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
        "https://app-api.internal/api/operator/audit/aevt_01HQ",
      ]);
      expect(forwardedOperatorEmails).toEqual([
        "ops@example.com",
        "ops@example.com",
        "ops@example.com",
        "ops@example.com",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("smokes request queries through protected-panel-web into app-api with internal caller admission", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-smoke.cloudflareaccess.com";
    const certsUrl = `${accessTeamDomain}/cdn-cgi/access/certs`;
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "panel-test-key";
    const token = await new SignJWT({ email: "ops@example.com", sub: "operator-001" })
      .setProtectedHeader({ alg: "ES256", kid: "panel-test-key" })
      .setIssuer(accessTeamDomain)
      .setAudience("panel-operator-audience")
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
      const appApiEnv = {
        APP_API_NAME: "campus-agent-app-api",
        APP_API_ENVIRONMENT: "test" as const,
        BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
        PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
        SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
        SUPERVISOR_API_SHARED_SECRET: "shared-secret",
        APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
        APP_API_INTERNAL_SHARED_SECRET: "panel-bridge-secret",
        APP_API_DB: {
          connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
        },
      };
      const appApi = createAppApi(appApiEnv, {
        operatorQueryService: createOperatorQueryServiceMock({
          list: vi.fn().mockResolvedValue({
            page: {
              nextCursor: null,
            },
            requests: [
              {
                answerPreview: "图书馆开放到 22:00。",
                completedAt: "2026-03-28T08:00:01.000Z",
                conversationId: "conv_01HQ",
                durationMs: 812,
                errorCode: null,
                principalId: "user_01HQ",
                principalLabel: "Jane Doe",
                principalType: "campus_member",
                projectedAt: "2026-03-28T08:00:02.000Z",
                questionPreview: "图书馆开放到几点？",
                requestId: "req_01HQ",
                requestedCapability: "knowledge",
                requestedScope: {
                  collection: "student_handbook",
                  corpus: "regulations",
                },
                selectedTarget: "rag-specialist",
                sourceDocIds: ["handbook:library-hours"],
                startedAt: "2026-03-28T08:00:00.000Z",
                status: "completed",
                surface: "public_chat_web",
                traceId: "trace_01HQ",
              },
            ],
          }),
        }),
      });

      const response = await worker.fetch(
        new Request("https://panel.example.com/api/requests?status=completed", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
          },
          ASSETS: {
            fetch: async () =>
              new Response("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                },
                status: 200,
              }),
          },
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        requests: [
          {
            requestId: "req_01HQ",
            status: "completed",
          },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies official web site queries to app-api with the same trusted operator bridge", async () => {
    const originalFetch = globalThis.fetch;
    const accessTeamDomain = "https://team-official-web-sites.cloudflareaccess.com";
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
      .setAudience("panel-operator-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

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
        new Request("https://panel.example.com/api/official-web/sites", {
          headers: {
            "cf-access-jwt-assertion": token,
          },
        }),
        {
          ACCESS_POLICY_AUD: "panel-operator-audience",
          ACCESS_TEAM_DOMAIN: accessTeamDomain,
          APP_API: {
            fetch: async (request: Request) => {
              forwardedUrl = request.url;

              return new Response(
                JSON.stringify({
                  sites: [
                    {
                      siteId: "www_muc_edu_cn",
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
          PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
          PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
          PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        sites: [
          {
            siteId: "www_muc_edu_cn",
          },
        ],
      });
      expect(forwardedUrl).toBe("https://app-api.internal/api/operator/official-web/sites");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
