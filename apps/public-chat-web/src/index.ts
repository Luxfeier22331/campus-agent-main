export interface Env {
  APP_API?: {
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
      return jsonResponse(200, {
        status: "ready",
        app_api_base_url: env.APP_API_BASE_URL || "",
        public_hostname: env.PUBLIC_CHAT_HOSTNAME || "",
        runtime: "cloudflare-worker",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyToAppApi(request, env);
    }

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse(403, {
        error: {
          code: "public_surface_placeholder",
          message:
            "Public chat web keeps the root route as a placeholder until the forward UI shell is mounted here.",
        },
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

  return env.APP_API.fetch(
    new Request(appApiUrl.toString(), {
      body: shouldForwardBody(request.method) ? request.body : undefined,
      headers,
      method: request.method,
      redirect: request.redirect,
    }),
  );
}

function shouldForwardBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}
