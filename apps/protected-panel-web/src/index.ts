import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface Env {
  PANEL_APP_NAME?: string;
  PANEL_RUNTIME_API_BASE_URL?: string;
  PANEL_PROTECTED_HOSTNAME?: string;
  PANEL_PROTECTION_ENVELOPE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
}

interface OperatorContext {
  operator_id: string;
  principal_class: "human";
  subject: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;
const JWKS_BY_ISSUER = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return jsonResponse(200, {
        status: "ok",
        app_name: env.PANEL_APP_NAME || "campus-agent-protected-panel",
        surface: "protected-panel-web",
        runtime: "cloudflare-worker",
      });
    }

    if (request.method === "GET" && url.pathname === "/readyz") {
      return jsonResponse(200, {
        status: "ready",
        runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
        protected_hostname: env.PANEL_PROTECTED_HOSTNAME || "",
        protection_envelope: env.PANEL_PROTECTION_ENVELOPE || "required",
        runtime: "cloudflare-worker",
      });
    }

    if (request.method === "GET" && url.pathname === "/api/overview") {
      const admission = await validateProtectedApiRequest(request, env);
      if (admission.error) {
        return admission.error;
      }

      return jsonResponse(200, {
        status: "ok",
        app_name: env.PANEL_APP_NAME || "campus-agent-protected-panel",
        surface: "protected-panel-web",
        runtime: "cloudflare-worker",
        protected_hostname: env.PANEL_PROTECTED_HOSTNAME || "",
        protection_envelope: env.PANEL_PROTECTION_ENVELOPE || "required",
        runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
        panel_domains: {
          overview: "ready",
          requests: "blocked",
          jobs: "blocked",
          operations: "deferred",
          audit: "blocked",
        },
        ...(admission.operatorContext ? { operator_context: admission.operatorContext } : {}),
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse(403, {
        error: {
          code: "protected_surface_required",
          message:
            "Protected panel stays fail-closed until an outer protected access envelope and panel-facing runtime API inventory are configured.",
        },
        runtime_api_base_url: env.PANEL_RUNTIME_API_BASE_URL || "",
        protected_hostname: env.PANEL_PROTECTED_HOSTNAME || "",
      });
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

async function validateProtectedApiRequest(
  request: Request,
  env: Env,
): Promise<{ error: Response | null; operatorContext: OperatorContext | null }> {
  if (env.PANEL_PROTECTION_ENVELOPE !== "cloudflare-access") {
    return { error: null, operatorContext: null };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_POLICY_AUD) {
    return {
      error: textResponse("Missing Access configuration.", 403),
      operatorContext: null,
    };
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return {
      error: textResponse("Missing Access JWT.", 401),
      operatorContext: null,
    };
  }

  const issuer = normalizeIssuer(env.ACCESS_TEAM_DOMAIN);

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(issuer), {
      issuer,
      audience: env.ACCESS_POLICY_AUD,
    });
    return {
      error: null,
      operatorContext: mapOperatorContext(payload),
    };
  } catch {
    return {
      error: textResponse("Invalid Access JWT.", 401),
      operatorContext: null,
    };
  }
}

function mapOperatorContext(payload: JWTPayload): OperatorContext {
  const subject = String(payload.sub || "");
  const email = typeof payload.email === "string" ? payload.email : "";

  return {
    operator_id: email || subject,
    principal_class: "human",
    subject,
  };
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
