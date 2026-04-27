export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	PUBLIC_DOCS_APP_NAME?: string;
	PUBLIC_DOCS_HOSTNAME?: string;
}

const DOCS_API_PREFIX = "/api/docs/";
const READER_FALLBACK_PATH = "/reader-fallback.html";
const FORWARDED_HEADERS = [
	"accept",
	"content-type",
	"cookie",
	"if-modified-since",
	"if-none-match",
	"x-trace-id",
] as const;

const JSON_HEADERS = {
	"cache-control": "no-store",
	"content-type": "application/json; charset=utf-8",
} as const;

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, {
				status: "ok",
				app_name: env.PUBLIC_DOCS_APP_NAME || "campus-agent-public-docs",
				surface: "public-docs",
				runtime: "cloudflare-worker",
			});
		}

		if (request.method === "GET" && url.pathname === "/readyz") {
			return serveReadiness(env);
		}

		if (url.pathname.startsWith(DOCS_API_PREFIX)) {
			return proxyDocsControlPlane(request, env);
		}

		if (url.pathname.startsWith("/api/")) {
			return jsonResponse(404, {
				error: {
					code: "not_found",
					message: "Route not found.",
				},
			});
		}

		if (request.method === "GET" || request.method === "HEAD") {
			return serveStaticDocs(request, env);
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
	if (!env.PUBLIC_DOCS_HOSTNAME?.trim()) {
		missing.push("PUBLIC_DOCS_HOSTNAME");
	}

	return missing;
}

async function serveReadiness(env: Env): Promise<Response> {
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
		app_api_base_url: env.APP_API_BASE_URL || "",
		dependencies: {
			appApiBinding: "configured",
			appApiRuntime: "ready",
			assets: "configured",
		},
		public_hostname: env.PUBLIC_DOCS_HOSTNAME || "",
		runtime: "cloudflare-worker",
	});
}

async function probeAppApiRuntime(env: Env): Promise<string | null> {
	if (!(env.APP_API && env.APP_API_BASE_URL)) {
		return "App API binding is not configured.";
	}

	try {
		const response = await env.APP_API.fetch(
			new Request(new URL("/readyz", env.APP_API_BASE_URL).toString(), {
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

async function proxyDocsControlPlane(request: Request, env: Env): Promise<Response> {
	if (!(env.APP_API && env.APP_API_BASE_URL)) {
		return appApiBridgeNotConfiguredResponse();
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

	try {
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
	} catch {
		return appApiUpstreamUnavailableResponse();
	}
}

function shouldForwardBody(method: string): boolean {
	return method !== "GET" && method !== "HEAD";
}

function appApiBridgeNotConfiguredResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			message: "App API binding is not configured.",
		},
	});
}

function appApiUpstreamUnavailableResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			details: null,
			message: "App API upstream is unavailable.",
			requestId: null,
			retryable: true,
			traceId: null,
		},
	});
}

async function serveStaticDocs(request: Request, env: Env): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "Public docs frontend assets are not configured.",
			},
		});
	}

	const response = await env.ASSETS.fetch(request);
	if (response.status === 404 && isDocsReaderRoute(new URL(request.url).pathname)) {
		const fallbackUrl = new URL(READER_FALLBACK_PATH, request.url);
		const fallbackResponse = await env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
		return withNoStore(fallbackResponse);
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("text/html")) {
		return response;
	}

	return withNoStore(response);
}

function isDocsReaderRoute(pathname: string): boolean {
	return pathname.startsWith("/docs/") && pathname.split("/").filter(Boolean).length >= 4;
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

export default worker;
