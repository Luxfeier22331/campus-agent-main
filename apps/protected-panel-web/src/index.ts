import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface Env {
  APP_API?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  ASSETS?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  PANEL_APP_NAME?: string;
  PANEL_APP_API_SHARED_SECRET?: string;
  PANEL_RUNTIME_API_BASE_URL?: string;
  PANEL_PROTECTION_ENVELOPE?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
}

interface OperatorContext {
  operator_id: string;
  principal_class: "human";
  subject: string;
  display_name: string | null;
  email: string | null;
  groups: string[];
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;
const CLOUDFLARE_ACCESS_ENVELOPE = "cloudflare-access";
const PLACEHOLDER_ACCESS_POLICY_AUD = "panel-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const REQUIRED_PROTECTION_ENVELOPE = "PANEL_PROTECTION_ENVELOPE=cloudflare-access";
const JWKS_BY_ISSUER = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const FORWARDED_HEADERS = ["accept", "content-type", "x-trace-id"] as const;

const SENSITIVE_EVENT_FIELDS = new Set([
  "authorization",
  "cf-access-jwt-assertion",
  "cookie",
  "operator_email",
  "x-app-internal-auth",
]);

function scrubSensitiveRecord(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_EVENT_FIELDS.has(key.toLowerCase())) {
      delete (value as Record<string, unknown>)[key];
    }
  }
}

function createSentryOptions(env: Env): CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    return undefined;
  }

  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
    initialScope: {
      tags: {
        app: env.PANEL_APP_NAME || "campus-agent-protected-panel",
        runtime: "cloudflare-worker",
        surface: "protected-panel-web",
      },
    },
    release: env.SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 1,
    beforeSend(event) {
      scrubSensitiveRecord(event.request?.headers);
      scrubSensitiveRecord(event.request?.data);
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
  };
}

function resolveTraceHeaders(request: Request): {
  baggage?: string;
  sentryTrace?: string;
} {
  const traceData = Sentry.getTraceData();

  return {
    baggage: request.headers.get("baggage") ?? traceData.baggage,
    sentryTrace: request.headers.get("sentry-trace") ?? traceData["sentry-trace"],
  };
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const protectedHostname = url.hostname;

    if (request.method === "GET" && url.pathname === "/healthz") {
      return jsonResponse(200, {
        status: "ok",
        app_name: env.PANEL_APP_NAME || "campus-agent-protected-panel",
        surface: "protected-panel-web",
        runtime: "cloudflare-worker",
      });
    }

    if (request.method === "GET" && url.pathname === "/readyz") {
      const missing = getMissingRuntimeConfig(env);
      if (missing.length > 0) {
        return jsonResponse(503, {
          error: {
            code: "dependency_not_ready",
            details: {
              missing,
            },
            message: "Runtime configuration is incomplete.",
          },
        });
      }

      const appApiRuntimeError = await probeAppApiRuntime(env);
      if (appApiRuntimeError) {
        return jsonResponse(503, {
          error: {
            code: "dependency_not_ready",
            details: {
              appApiRuntime: appApiRuntimeError,
            },
            message: "Runtime configuration is incomplete.",
          },
        });
      }

      return jsonResponse(200, {
        status: "ready",
        dependencies: {
          accessOriginAdmission: "configured",
          appApiBinding: "configured",
          appApiRuntime: "ready",
          assets: "configured",
          operatorBridge: "configured",
        },
        runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
        protected_hostname: protectedHostname,
        protection_envelope: env.PANEL_PROTECTION_ENVELOPE || "required",
        runtime: "cloudflare-worker",
      });
    }

    if (request.method === "GET" && url.pathname === "/api/overview") {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }
      if (!hasAppApiBridge(env)) {
        return appApiBridgeNotConfiguredResponse();
      }

      return jsonResponse(200, {
        status: "ok",
        app_name: env.PANEL_APP_NAME || "campus-agent-protected-panel",
        surface: "protected-panel-web",
        runtime: "cloudflare-worker",
        protected_hostname: protectedHostname,
        protection_envelope: env.PANEL_PROTECTION_ENVELOPE || "required",
        runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
        panel_domains: {
          overview: "ready",
          requests: "ready",
          official_web: "ready",
          jobs: "blocked",
          operations: "deferred",
          audit: "blocked",
        },
        ...(admission.operatorContext ? { operator_context: admission.operatorContext } : {}),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/official-web/sites") {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      if (!admission.operatorContext) {
        return jsonResponse(403, {
          error: {
            code: "operator_identity_required",
            message: "Protected official web queries require a trusted operator identity.",
          },
        });
      }

      return proxyToAppApi({
        env,
        operatorContext: admission.operatorContext,
        request,
        targetPath: `/api/operator/official-web/sites${url.search}`,
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/official-web/sites/")) {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      if (!admission.operatorContext) {
        return jsonResponse(403, {
          error: {
            code: "operator_identity_required",
            message: "Protected official web queries require a trusted operator identity.",
          },
        });
      }

      const siteId = url.pathname.slice("/api/official-web/sites/".length);
      if (!siteId) {
        return jsonResponse(404, {
          error: {
            code: "not_found",
            message: "Route not found.",
          },
        });
      }

      return proxyToAppApi({
        env,
        operatorContext: admission.operatorContext,
        request,
        targetPath: `/api/operator/official-web/sites/${siteId}${url.search}`,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/official-web/runs") {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      if (!admission.operatorContext) {
        return jsonResponse(403, {
          error: {
            code: "operator_identity_required",
            message: "Protected official web queries require a trusted operator identity.",
          },
        });
      }

      return proxyToAppApi({
        env,
        operatorContext: admission.operatorContext,
        request,
        targetPath: `/api/operator/official-web/runs${url.search}`,
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/official-web/runs/")) {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      if (!admission.operatorContext) {
        return jsonResponse(403, {
          error: {
            code: "operator_identity_required",
            message: "Protected official web queries require a trusted operator identity.",
          },
        });
      }

      const runId = url.pathname.slice("/api/official-web/runs/".length);
      if (!runId) {
        return jsonResponse(404, {
          error: {
            code: "not_found",
            message: "Route not found.",
          },
        });
      }

      return proxyToAppApi({
        env,
        operatorContext: admission.operatorContext,
        request,
        targetPath: `/api/operator/official-web/runs/${runId}${url.search}`,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/requests") {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      if (!admission.operatorContext) {
        return jsonResponse(403, {
          error: {
            code: "operator_identity_required",
            message: "Protected request queries require a trusted operator identity.",
          },
        });
      }

      return proxyToAppApi({
        env,
        operatorContext: admission.operatorContext,
        request,
        targetPath: `/api/operator/requests${url.search}`,
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/requests/")) {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      if (!admission.operatorContext) {
        return jsonResponse(403, {
          error: {
            code: "operator_identity_required",
            message: "Protected request queries require a trusted operator identity.",
          },
        });
      }

      const requestId = url.pathname.slice("/api/requests/".length);
      if (!requestId) {
        return jsonResponse(404, {
          error: {
            code: "not_found",
            message: "Route not found.",
          },
        });
      }

      return proxyToAppApi({
        env,
        operatorContext: admission.operatorContext,
        request,
        targetPath: `/api/operator/requests/${requestId}${url.search}`,
      });
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      !url.pathname.startsWith("/api/")
    ) {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }
      if (!hasAppApiBridge(env)) {
        return appApiBridgeNotConfiguredResponse();
      }

      return serveProtectedShell(request, env);
    }

    return jsonResponse(404, {
      error: {
        code: "not_found",
        message: "Route not found.",
      },
    });
  },
};

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function appApiUpstreamUnavailableResponse(): Response {
  return jsonResponse(503, {
    error: {
      code: "dependency_not_ready",
      message: "App API upstream is unavailable.",
      retryable: true,
      traceId: null,
      requestId: null,
      details: null,
    },
  });
}

function getMissingRuntimeConfig(env: Env): string[] {
  const missing: string[] = [];

  if (!env.APP_API) {
    missing.push("APP_API binding");
  }
  if (!env.ASSETS) {
    missing.push("ASSETS binding");
  }
  if (!env.PANEL_RUNTIME_API_BASE_URL?.trim()) {
    missing.push("PANEL_RUNTIME_API_BASE_URL");
  }
  if (!env.PANEL_APP_API_SHARED_SECRET?.trim()) {
    missing.push("PANEL_APP_API_SHARED_SECRET");
  }
  missing.push(...getMissingAccessConfig(env));

  return missing;
}

function appApiBridgeNotConfiguredResponse(): Response {
  return jsonResponse(503, {
    error: {
      code: "dependency_not_ready",
      message: "App API binding is not configured.",
    },
  });
}

function hasAppApiBridge(env: Env): boolean {
  return Boolean(
    env.APP_API &&
      env.PANEL_RUNTIME_API_BASE_URL?.trim() &&
      env.PANEL_APP_API_SHARED_SECRET?.trim(),
  );
}

function normalizeConfiguredAccessTeamDomain(teamDomain: string | undefined): string | null {
  const trimmed = teamDomain?.trim();
  if (!trimmed) {
    return null;
  }

  let normalized: string;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    normalized = parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }

  return normalized === PLACEHOLDER_ACCESS_TEAM_DOMAIN ? null : normalized;
}

function normalizeConfiguredAccessPolicyAud(audience: string | undefined): string | null {
  const trimmed = audience?.trim();
  if (!trimmed || trimmed === PLACEHOLDER_ACCESS_POLICY_AUD) {
    return null;
  }

  return trimmed;
}

async function validateProtectedApiRequest(
  request: Request,
  env: Env,
): Promise<{ error: Response | null; operatorContext: OperatorContext | null }> {
  const missingAccessConfig = getMissingAccessConfig(env);
  if (missingAccessConfig.length > 0) {
    return {
      error: protectionNotConfiguredResponse(missingAccessConfig),
      operatorContext: null,
    };
  }

  const token = resolveAccessAssertion(request);
  if (!token) {
    return {
      error: textResponse("Missing Access JWT.", 401),
      operatorContext: null,
    };
  }

  const issuer = normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD);
  if (!issuer || !audience) {
    return {
      error: protectionNotConfiguredResponse(getMissingAccessConfig(env)),
      operatorContext: null,
    };
  }

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
      issuer,
      audience,
    });
    const operatorContext = mapOperatorContext(payload);
    if (!operatorContext) {
      return {
        error: textResponse("Invalid Access JWT.", 401),
        operatorContext: null,
      };
    }

    return {
      error: null,
      operatorContext,
    };
  } catch {
    return {
      error: textResponse("Invalid Access JWT.", 401),
      operatorContext: null,
    };
  }
}

function resolveAccessAssertion(request: Request): string | null {
  const headerToken = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (headerToken) {
    return headerToken;
  }

  return readCookieValue(request.headers.get("cookie"), "CF_Authorization");
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = segment.slice(0, separatorIndex).trim();
    if (cookieName !== name) {
      continue;
    }

    const cookieValue = segment.slice(separatorIndex + 1).trim();
    return cookieValue || null;
  }

  return null;
}

function getMissingAccessConfig(env: Env): string[] {
  const missing: string[] = [];

  if (env.PANEL_PROTECTION_ENVELOPE !== CLOUDFLARE_ACCESS_ENVELOPE) {
    missing.push(REQUIRED_PROTECTION_ENVELOPE);
  }
  if (!normalizeConfiguredAccessTeamDomain(env.ACCESS_TEAM_DOMAIN)) {
    missing.push("ACCESS_TEAM_DOMAIN");
  }
  if (!normalizeConfiguredAccessPolicyAud(env.ACCESS_POLICY_AUD)) {
    missing.push("ACCESS_POLICY_AUD");
  }

  return missing;
}

function protectionNotConfiguredResponse(missing: string[]): Response {
  return jsonResponse(503, {
    error: {
      code: "dependency_not_ready",
      details: {
        missing,
      },
      message: "Protected panel admission is not configured.",
    },
  });
}

function mapOperatorContext(payload: JWTPayload): OperatorContext | null {
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!(email || subject)) {
    return null;
  }

  const displayName =
    typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null;
  const groups = Array.isArray(payload.groups)
    ? payload.groups
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];

  return {
    display_name: displayName,
    email: email || null,
    groups,
    operator_id: email || subject,
    principal_class: "human",
    subject,
  };
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function getRemoteJwks(issuer: string) {
  const cached = JWKS_BY_ISSUER.get(issuer);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  JWKS_BY_ISSUER.set(issuer, jwks);
  return jwks;
}

async function proxyToAppApi(input: {
  env: Env;
  operatorContext: OperatorContext;
  request: Request;
  targetPath: string;
}): Promise<Response> {
  const appApi = input.env.APP_API;
  const runtimeApiBaseUrl = input.env.PANEL_RUNTIME_API_BASE_URL?.trim();
  const panelAppApiSharedSecret = input.env.PANEL_APP_API_SHARED_SECRET?.trim();

  if (!appApi || !runtimeApiBaseUrl || !panelAppApiSharedSecret) {
    return appApiBridgeNotConfiguredResponse();
  }

  const targetUrl = new URL(input.targetPath, runtimeApiBaseUrl);
  const headers = new Headers();

  for (const headerName of FORWARDED_HEADERS) {
    const value = input.request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }
  const traceHeaders = resolveTraceHeaders(input.request);
  if (traceHeaders.sentryTrace) {
    headers.set("sentry-trace", traceHeaders.sentryTrace);
  }
  if (traceHeaders.baggage) {
    headers.set("baggage", traceHeaders.baggage);
  }

  headers.set("x-app-operator-email", input.operatorContext.email ?? input.operatorContext.operator_id);
  headers.set("x-app-internal-auth", panelAppApiSharedSecret);
  headers.set("x-app-operator-id", input.operatorContext.operator_id);

  if (input.operatorContext.display_name) {
    headers.set("x-app-operator-name", input.operatorContext.display_name);
  }

  try {
    const response = await appApi.fetch(
      new Request(targetUrl.toString(), {
        body: shouldForwardBody(input.request.method) ? input.request.body : undefined,
        headers,
        method: input.request.method,
        redirect: input.request.redirect,
      }),
    );

    return withNoStore(response);
  } catch {
    return appApiUpstreamUnavailableResponse();
  }
}

async function serveProtectedShell(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) {
    return jsonResponse(503, {
      error: {
        code: "frontend_assets_not_ready",
        message: "Protected panel frontend assets are not configured.",
      },
    });
  }

  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function shouldForwardBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function probeAppApiRuntime(env: Env): Promise<string | null> {
  if (!hasAppApiBridge(env)) {
    return "App API binding is not configured.";
  }

  try {
    const response = await env.APP_API!.fetch(
      new Request(new URL("/readyz", env.PANEL_RUNTIME_API_BASE_URL).toString(), {
        method: "GET",
      }),
    );
    if (response.status !== 200) {
      return `app-api readyz returned ${response.status}`;
    }

    const payload = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (payload?.status !== "ready") {
      return "app-api readyz returned an invalid payload";
    }

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "app-api readyz probe failed";
  }
}

export default Sentry.withSentry(createSentryOptions, worker);
