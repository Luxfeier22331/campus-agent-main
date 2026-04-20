import * as Sentry from "@sentry/cloudflare";

import {
  appApiBridgeNotConfiguredResponse,
  appApiUpstreamUnavailableResponse,
  jsonResponse,
  withNoStore,
} from "./responses";
import {
  FORWARDED_HEADERS,
  type Env,
  type OperatorContext,
} from "./types";

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

function shouldForwardBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

export async function proxyToAppApi(input: {
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

export async function serveProtectedShell(request: Request, env: Env): Promise<Response> {
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
