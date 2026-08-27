import type { CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import { APP_API_ROUTE_EXPOSURE_INVENTORY } from "../../app/route-exposure";
import { type Env, resolveAppName, resolveEnvironment } from "../../config";

const SAFE_TAGS = new Set([
	"app",
	"campus.request_id",
	"error_code",
	"route",
	"runtime",
	"status",
	"surface",
]);

const SENSITIVE_IDENTIFIER =
	/\b(?:command|conversation|conv|item|message|msg|request|req|run)[_-][a-z0-9_-]+\b/giu;
const SENSITIVE_QUERY_VALUE = /([?&](?:code|token|resetToken|redirectTo|state)=)[^&#\s]*/giu;
const URL_WITH_QUERY = /(https?:\/\/[^\s?#]+)\?[^\s#]*/giu;

type SentrySpan = Parameters<NonNullable<CloudflareOptions["beforeSendSpan"]>>[0];
type SentryTransaction = Parameters<NonNullable<CloudflareOptions["beforeSendTransaction"]>>[0];
type SentryTraceContext = NonNullable<NonNullable<ErrorEvent["contexts"]>["trace"]>;

export function createAppApiSentryOptions(env: Env): CloudflareOptions | undefined {
	const dsn = env.SENTRY_DSN?.trim();
	if (!dsn) {
		return;
	}
	const environment = resolveEnvironment(env);
	return {
		beforeSend: sanitizeAppApiSentryEvent,
		beforeSendSpan: sanitizeAppApiSentrySpan,
		beforeSendTransaction: sanitizeAppApiSentryTransaction,
		dataCollection: {
			cookies: false,
			frameContextLines: 0,
			genAI: { inputs: false, outputs: false },
			httpBodies: [],
			httpHeaders: { request: false, response: false },
			queryParams: false,
			stackFrameVariables: false,
			userInfo: false,
		},
		dsn,
		environment,
		initialScope: {
			tags: {
				app: resolveAppName(),
				runtime: "cloudflare-worker",
				surface: "app_api",
			},
		},
		integrations(defaultIntegrations) {
			return [
				...defaultIntegrations.filter(
					(integration) => integration.name !== "HttpServer" && integration.name !== "RequestData",
				),
				Sentry.httpServerIntegration({ maxRequestBodySize: "none" }),
				Sentry.requestDataIntegration({
					include: {
						cookies: false,
						data: false,
						headers: false,
						ip: false,
						query_string: false,
						url: false,
					},
				}),
			];
		},
		release: env.DEPLOYMENT_RELEASE?.trim() || undefined,
		sendDefaultPii: false,
	};
}

export function normalizeAppApiRoute(value: string | null | undefined, method?: string): string {
	const pathname = pathnameFrom(value);
	const normalizedMethod = method?.toUpperCase();
	for (const route of APP_API_ROUTE_EXPOSURE_INVENTORY) {
		if (normalizedMethod && route.method !== "ALL" && route.method !== normalizedMethod) {
			continue;
		}
		if (matchesRouteTemplate(pathname, route.path)) {
			return route.path;
		}
	}
	return pathname.startsWith("/api/") ? "/api/<unmatched>" : "/<unmatched>";
}

export function sanitizeAppApiSentryEvent(event: ErrorEvent): ErrorEvent {
	return sanitizeAppApiSentryEventPayload(event);
}

export function sanitizeAppApiSentryTransaction(event: SentryTransaction): SentryTransaction {
	return sanitizeAppApiSentryEventPayload(event);
}

function sanitizeAppApiSentryEventPayload<T extends ErrorEvent | SentryTransaction>(event: T): T {
	const method = event.request?.method?.toUpperCase();
	const route = normalizeAppApiRoute(event.request?.url ?? event.transaction, method);
	const exceptionType = normalizeExceptionType(event.exception?.values?.[0]?.type);
	event.request = {
		...(method ? { method } : {}),
		url: route,
	};
	event.transaction = route;
	event.breadcrumbs = [];
	delete event.extra;
	delete event.fingerprint;
	delete event.user;
	event.tags = Object.fromEntries(
		Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAGS.has(key)),
	);
	if (event.tags.route) {
		event.tags.route = normalizeAppApiRoute(String(event.tags.route), method);
	}
	event.contexts = event.contexts?.trace
		? { trace: sanitizeTraceContext(event.contexts.trace) }
		: {};
	if (event.spans) {
		event.spans = event.spans.map(sanitizeAppApiSentrySpan);
	} else {
		delete event.spans;
	}
	event.message = exceptionType;
	if (event.logentry?.message) {
		event.logentry.message = exceptionType;
		delete event.logentry.params;
	}
	for (const exception of event.exception?.values ?? []) {
		exception.type = normalizeExceptionType(exception.type);
		exception.value = exception.type;
		for (const frame of exception.stacktrace?.frames ?? []) {
			const absolutePath = scrubSensitiveText(frame.abs_path);
			const filename = scrubSensitiveText(frame.filename);
			if (absolutePath) {
				frame.abs_path = absolutePath;
			} else {
				delete frame.abs_path;
			}
			delete frame.context_line;
			if (filename) {
				frame.filename = filename;
			} else {
				delete frame.filename;
			}
			delete frame.post_context;
			delete frame.pre_context;
			delete frame.vars;
		}
	}
	return event;
}

export function sanitizeAppApiSentrySpan(span: SentrySpan): SentrySpan {
	const method = readSpanString(span.data, ["http.request.method", "http.method", "method"]);
	const route = normalizeAppApiRoute(
		readSpanString(span.data, ["http.route", "url.full", "url.path"]) ?? span.description,
		method,
	);
	const status = readSpanValue(span.data, ["http.response.status_code", "http.status_code"]);
	return {
		...span,
		data: {
			...(method ? { "http.request.method": method.toUpperCase() } : {}),
			...(route ? { "http.route": route } : {}),
			...(status === undefined ? {} : { "http.response.status_code": status }),
		},
		description: method ? `${method.toUpperCase()} ${route}` : route,
		links: [],
	};
}

function sanitizeTraceContext(trace: SentryTraceContext): SentryTraceContext {
	return {
		span_id: trace.span_id,
		trace_id: trace.trace_id,
		...(trace.op ? { op: trace.op } : {}),
		...(trace.origin ? { origin: trace.origin } : {}),
		...(trace.parent_span_id ? { parent_span_id: trace.parent_span_id } : {}),
		...(trace.status ? { status: trace.status } : {}),
	};
}

function pathnameFrom(value: string | null | undefined): string {
	if (!value?.trim()) {
		return "/<unknown>";
	}
	const withoutMethod = value.trim().replace(/^[A-Z]+\s+/u, "");
	try {
		return new URL(withoutMethod, "https://sentry.invalid").pathname || "/";
	} catch {
		return "/<unknown>";
	}
}

function matchesRouteTemplate(pathname: string, template: string): boolean {
	if (template.endsWith("/*")) {
		return pathname === template.slice(0, -2) || pathname.startsWith(template.slice(0, -1));
	}
	const pattern = template
		.split("/")
		.map((segment) => (segment.startsWith(":") ? "[^/]+" : RegExp.escape(segment)))
		.join("/");
	return new RegExp(`^${pattern}$`, "u").test(pathname);
}

function readSpanString(data: SentrySpan["data"], keys: string[]): string | undefined {
	const value = readSpanValue(data, keys);
	return typeof value === "string" ? value : undefined;
}

function readSpanValue(
	data: SentrySpan["data"],
	keys: string[],
): string | number | boolean | undefined {
	for (const key of keys) {
		const value = data[key];
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			return value;
		}
	}
	return;
}

function scrubSensitiveText(value: string | undefined): string | undefined {
	return value
		?.replace(URL_WITH_QUERY, "$1")
		.replace(SENSITIVE_QUERY_VALUE, "$1[redacted]")
		.replace(SENSITIVE_IDENTIFIER, "[id]");
}

function normalizeExceptionType(value: string | undefined): string {
	const normalized = value?.replace(/[^a-z0-9_.-]/giu, "_").slice(0, 96);
	return normalized || "ApplicationError";
}
