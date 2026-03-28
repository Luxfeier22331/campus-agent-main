export interface Env {
  APP_API?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  ASSETS?: {
    fetch(request: Request): Promise<Response> | Response;
  };
  APP_API_BASE_URL?: string;
  PUBLIC_CHAT_APP_NAME?: string;
  PUBLIC_CHAT_HOSTNAME?: string;
}

const FORWARDED_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "idempotency-key",
  "x-trace-id",
] as const;

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return jsonResponse(200, {
        status: "ok",
        app_name: env.PUBLIC_CHAT_APP_NAME || "campus-agent-public-chat-web",
        surface: "public-chat-web",
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

      return jsonResponse(200, {
        status: "ready",
        app_api_base_url: env.APP_API_BASE_URL || "",
        dependencies: {
          appApiBinding: "configured",
          assets: "configured",
        },
        public_hostname: env.PUBLIC_CHAT_HOSTNAME || "",
        runtime: "cloudflare-worker",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyToAppApi(request, env);
    }

    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      return servePublicShell(request, env);
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

function getMissingRuntimeConfig(env: Env): string[] {
  const missing: string[] = [];

  if (!env.APP_API) {
    missing.push("APP_API binding");
  }
  if (!env.ASSETS) {
    missing.push("ASSETS binding");
  }
  if (!env.APP_API_BASE_URL?.trim()) {
    missing.push("APP_API_BASE_URL");
  }
  if (!env.PUBLIC_CHAT_HOSTNAME?.trim()) {
    missing.push("PUBLIC_CHAT_HOSTNAME");
  }

  return missing;
}

async function proxyToAppApi(request: Request, env: Env): Promise<Response> {
  if (!env.APP_API || !env.APP_API_BASE_URL) {
    return jsonResponse(503, {
      error: {
        code: "dependency_not_ready",
        message: "App API binding is not configured.",
      },
    });
  }

  const inboundUrl = new URL(request.url);
  const appApiUrl = new URL(inboundUrl.pathname + inboundUrl.search, env.APP_API_BASE_URL);
  const headers = new Headers();

  for (const headerName of FORWARDED_HEADERS) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return withNoStore(
    await env.APP_API.fetch(
    new Request(appApiUrl.toString(), {
      body: shouldForwardBody(request.method) ? request.body : undefined,
      headers,
      method: request.method,
      redirect: request.redirect,
    }),
    ),
  );
}

function shouldForwardBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function servePublicShell(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) {
    return jsonResponse(503, {
      error: {
        code: "frontend_assets_not_ready",
        message: "Public chat frontend assets are not configured.",
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
