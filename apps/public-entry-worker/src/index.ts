import { createRemoteJWKSet, jwtVerify } from "jose";

export type EntryMode = "authenticated-only" | "anonymous-enabled";

export interface Env {
  ORIGIN_BASE_URL: string;
  ORIGIN_SHARED_SECRET: string;
  ENTRY_MODE: EntryMode;
  WORKER_ALLOW_ANONYMOUS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
}

const FORWARDED_HEADERS = [
  "accept",
  "cf-access-jwt-assertion",
  "content-type",
  "x-trace-id",
] as const;
const JWKS_BY_ISSUER = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const configError = validateRuntimeConfig(env);
    if (configError) {
      return configError;
    }

    if (env.ENTRY_MODE === "authenticated-only") {
      const authError = await validateAuthenticatedRequest(request, env);
      if (authError) {
        return authError;
      }
    } else if (env.ENTRY_MODE === "anonymous-enabled") {
      if (env.WORKER_ALLOW_ANONYMOUS !== "true") {
        return textResponse("Anonymous entry is disabled.", 403);
      }
    } else {
      return textResponse("Unsupported entry mode.", 403);
    }

    const outboundRequest = buildOriginRequest(request, env);
    return fetch(outboundRequest);
  },
};

function validateRuntimeConfig(env: Env): Response | null {
  if (!env.ORIGIN_BASE_URL) {
    return textResponse("Missing ORIGIN_BASE_URL.", 503);
  }
  if (!env.ORIGIN_SHARED_SECRET) {
    return textResponse("Missing ORIGIN_SHARED_SECRET.", 503);
  }

  try {
    new URL(env.ORIGIN_BASE_URL);
  } catch {
    return textResponse("Invalid ORIGIN_BASE_URL.", 503);
  }

  return null;
}

async function validateAuthenticatedRequest(request: Request, env: Env): Promise<Response | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_POLICY_AUD) {
    return textResponse("Missing Access configuration.", 403);
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return textResponse("Missing Access JWT.", 401);
  }

  const issuer = normalizeIssuer(env.ACCESS_TEAM_DOMAIN);

  try {
    await jwtVerify(token, getRemoteJwks(issuer), {
      issuer,
      audience: env.ACCESS_POLICY_AUD,
    });
    return null;
  } catch {
    return textResponse("Invalid Access JWT.", 401);
  }
}

function buildOriginRequest(request: Request, env: Env): Request {
  const inboundUrl = new URL(request.url);
  const originBaseUrl = new URL(env.ORIGIN_BASE_URL);
  const originUrl = new URL(inboundUrl.pathname + inboundUrl.search, originBaseUrl);
  const headers = new Headers();

  for (const headerName of FORWARDED_HEADERS) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  headers.set("x-worker-origin-auth", env.ORIGIN_SHARED_SECRET);

  return new Request(originUrl.toString(), {
    method: request.method,
    headers,
    body: shouldForwardBody(request.method) ? request.body : undefined,
    redirect: request.redirect,
  });
}

function shouldForwardBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function normalizeIssuer(teamDomain: string): string {
  return teamDomain.endsWith("/") ? teamDomain.slice(0, -1) : teamDomain;
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
