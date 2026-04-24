import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";
import {
	AUTH_RUNTIME_CONFIG_SCRIPT_ID,
	resolveTurnstileRuntimeConfig,
} from "./platform/auth/turnstile-runtime-config";
import {
	getAllGatewayModels,
	getCapabilities,
	isDemo,
} from "./platform/vendor-compat/lib/ai/models";

export interface Env {
	APP_API?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	ASSETS?: {
		fetch(request: Request): Promise<Response> | Response;
	};
	APP_API_BASE_URL?: string;
	AUTH_TURNSTILE_APPEARANCE?: string;
	AUTH_TURNSTILE_EXECUTION?: string;
	AUTH_TURNSTILE_SITE_KEY?: string;
	PUBLIC_CHAT_APP_NAME?: string;
	PUBLIC_CHAT_HOSTNAME?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
}

const BASE_FORWARDED_HEADERS = [
	"accept",
	"content-type",
	"cookie",
	"idempotency-key",
	"x-trace-id",
] as const;
const AUTH_FORWARDED_HEADERS = [
	...BASE_FORWARDED_HEADERS,
	"origin",
	"referer",
	"x-captcha-response",
] as const;

const JSON_HEADERS = {
	"cache-control": "no-store",
	"content-type": "application/json; charset=utf-8",
} as const;

const LEGACY_CHAT_PREVIEW_PATH_PREFIX = "/chat/replatform-preview";
const SENSITIVE_EVENT_FIELDS = new Set(["authorization", "cookie", "prompt", "transcript"]);

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
		return;
	}

	return {
		dsn,
		environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
		initialScope: {
			tags: {
				app: env.PUBLIC_CHAT_APP_NAME || "campus-agent-public-chat-web",
				runtime: "cloudflare-worker",
				surface: "public-chat-web",
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
				public_hostname: env.PUBLIC_CHAT_HOSTNAME || "",
				runtime: "cloudflare-worker",
			});
		}

		if (request.method === "GET" && url.pathname === "/api/models") {
			return serveModelsCatalog();
		}

		if (url.pathname.startsWith("/api/")) {
			return proxyToAppApi(request, env);
		}

		if (
			(request.method === "GET" || request.method === "HEAD") &&
			url.pathname.startsWith(LEGACY_CHAT_PREVIEW_PATH_PREFIX)
		) {
			return redirectToCanonicalChatRoute(url);
		}

		if (
			(request.method === "GET" || request.method === "HEAD") &&
			!url.pathname.startsWith("/api/")
		) {
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

function redirectToCanonicalChatRoute(url: URL): Response {
	const redirectUrl = new URL(url.toString());
	redirectUrl.pathname = "/chat";

	return Response.redirect(redirectUrl.toString(), 302);
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

function appApiBridgeNotConfiguredResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			message: "App API binding is not configured.",
		},
	});
}

async function proxyToAppApi(request: Request, env: Env): Promise<Response> {
	if (!(env.APP_API && env.APP_API_BASE_URL)) {
		return appApiBridgeNotConfiguredResponse();
	}

	const inboundUrl = new URL(request.url);
	const appApiUrl = new URL(inboundUrl.pathname + inboundUrl.search, env.APP_API_BASE_URL);
	const headers = new Headers();

	for (const headerName of getForwardedHeaders(inboundUrl.pathname)) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}
	const traceHeaders = resolveTraceHeaders(request);
	if (traceHeaders.sentryTrace) {
		headers.set("sentry-trace", traceHeaders.sentryTrace);
	}
	if (traceHeaders.baggage) {
		headers.set("baggage", traceHeaders.baggage);
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

function getForwardedHeaders(pathname: string) {
	return pathname.startsWith("/api/auth/") ? AUTH_FORWARDED_HEADERS : BASE_FORWARDED_HEADERS;
}

function shouldForwardBody(method: string): boolean {
	return method !== "GET" && method !== "HEAD";
}

async function serveModelsCatalog(): Promise<Response> {
	const headers = {
		"Cache-Control": "public, max-age=86400, s-maxage=86400",
	};

	const curatedCapabilities = await getCapabilities();

	if (isDemo) {
		const models = await getAllGatewayModels();
		const capabilities = Object.fromEntries(
			models.map((model) => [model.id, curatedCapabilities[model.id] ?? model.capabilities]),
		);

		return Response.json({ capabilities, models }, { headers });
	}

	return Response.json(curatedCapabilities, { headers });
}

function injectAuthRuntimeConfig(html: string, env: Env): string {
	const serializedConfig = JSON.stringify(
		resolveTurnstileRuntimeConfig({
			turnstileAppearance: env.AUTH_TURNSTILE_APPEARANCE,
			turnstileExecution: env.AUTH_TURNSTILE_EXECUTION,
			turnstileSiteKey: env.AUTH_TURNSTILE_SITE_KEY,
		}),
	).replace(/</g, "\\u003c");
	const scriptTag = `<script id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${serializedConfig}</script>`;

	if (html.includes(`id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}"`)) {
		return html;
	}

	if (html.includes("</body>")) {
		return html.replace("</body>", `${scriptTag}</body>`);
	}

	return `${html}${scriptTag}`;
}

async function servePublicShell(request: Request, env: Env): Promise<Response> {
	if (!(env.APP_API && env.APP_API_BASE_URL)) {
		return appApiBridgeNotConfiguredResponse();
	}

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

	const html = await response.text();
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	return new Response(injectAuthRuntimeConfig(html, env), {
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

export default Sentry.withSentry(createSentryOptions, worker);
