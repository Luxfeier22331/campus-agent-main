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
const GATED_DOCS_PREFIX = "/_gated-docs/";
const COLLECTION_FALLBACK_PATH = "/collection-fallback.html";
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

		if (url.pathname.startsWith(GATED_DOCS_PREFIX)) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return jsonResponse(404, {
					error: {
						code: "not_found",
						message: "Route not found.",
					},
				});
			}
			return serveGatedReaderAsset(request, env);
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
	const pathname = new URL(request.url).pathname;
	if (response.status === 404 && isDocsCollectionRoute(pathname)) {
		const fallbackUrl = new URL(COLLECTION_FALLBACK_PATH, request.url);
		const fallbackResponse = await env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
		return withNoStore(fallbackResponse);
	}
	if (response.status === 404 && isDocsReaderRoute(pathname)) {
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

async function serveGatedReaderAsset(request: Request, env: Env): Promise<Response> {
	if (!env.ASSETS) {
		return jsonResponse(503, {
			error: {
				code: "frontend_assets_not_ready",
				message: "Public docs frontend assets are not configured.",
			},
		});
	}

	const gatedTarget = parseGatedReaderTarget(new URL(request.url).pathname);
	if (!gatedTarget) {
		return withNoStore(new Response(null, { status: 404 }), { varyAuth: true });
	}

	const admissionResponse = await checkGatedReaderAdmission({
		env,
		request,
		target: gatedTarget,
	});
	if (admissionResponse) {
		return admissionResponse;
	}

	const response = await env.ASSETS.fetch(request);
	if (response.status === 404) {
		return withNoStore(response, { varyAuth: true });
	}

	return withNoStore(response, { varyAuth: true });
}

async function checkGatedReaderAdmission(input: {
	env: Env;
	request: Request;
	target: {
		collection: string;
		corpus: string;
		documentSlug: string;
		versionSlug: string;
	};
}): Promise<Response | null> {
	if (!(input.env.APP_API && input.env.APP_API_BASE_URL)) {
		return appApiBridgeNotConfiguredResponse();
	}

	const admissionUrl = new URL(
		`/api/docs/collections/${encodeURIComponent(input.target.corpus)}/${encodeURIComponent(
			input.target.collection,
		)}/documents/${encodeURIComponent(input.target.documentSlug)}/admission?version=${encodeURIComponent(input.target.versionSlug)}`,
		input.env.APP_API_BASE_URL,
	);
	const headers = new Headers();
	for (const headerName of ["cookie", "authorization", "x-trace-id"]) {
		const value = input.request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	let response: Response;
	try {
		response = await input.env.APP_API.fetch(
			new Request(admissionUrl.toString(), {
				headers,
				method: "GET",
			}),
		);
	} catch {
		return appApiUpstreamUnavailableResponse();
	}

	if (response.status === 204) {
		return null;
	}

	return withNoStore(new Response(null, { status: 404 }), { varyAuth: true });
}

function parseGatedReaderTarget(pathname: string): {
	collection: string;
	corpus: string;
	documentSlug: string;
	versionSlug: string;
} | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length < 6 || segments[0] !== "_gated-docs") {
		return null;
	}
	const [, corpus, collection, documentSlug, versionSlug] = segments;
	if (!(corpus && collection && documentSlug && versionSlug)) {
		return null;
	}

	try {
		return {
			collection: decodeURIComponent(collection),
			corpus: decodeURIComponent(corpus),
			documentSlug: decodeURIComponent(documentSlug),
			versionSlug: decodeURIComponent(versionSlug),
		};
	} catch {
		return null;
	}
}

function isDocsReaderRoute(pathname: string): boolean {
	return pathname.startsWith("/docs/") && pathname.split("/").filter(Boolean).length >= 4;
}

function isDocsCollectionRoute(pathname: string): boolean {
	const segments = pathname.split("/").filter(Boolean);
	return segments.length === 3 && segments[0] === "docs";
}

function withNoStore(response: Response, options?: { varyAuth?: boolean }): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	if (options?.varyAuth) {
		addVary(headers, "Cookie, Authorization");
	}

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function addVary(headers: Headers, value: string): void {
	const existing = headers.get("vary");
	if (!existing) {
		headers.set("vary", value);
		return;
	}
	const normalized = existing
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
	for (const part of value.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) {
			continue;
		}
		if (!normalized.includes(trimmed.toLowerCase())) {
			normalized.push(trimmed.toLowerCase());
		}
	}
	headers.set(
		"vary",
		normalized
			.map((item) =>
				item === "cookie" ? "Cookie" : item === "authorization" ? "Authorization" : item,
			)
			.join(", "),
	);
}

export default worker;
