import type { Breadcrumb, CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";

const SAFE_TAGS = new Set([
	"app",
	"campus.request_id",
	"error_code",
	"route",
	"runtime",
	"status",
	"surface",
]);

const CAMPUS_ROUTE_TEMPLATES = [
	"/",
	"/c/:conversationId",
	"/map",
	"/dining",
	"/groups",
	"/feedback",
	"/notices",
	"/notices/:noticeId",
	"/account",
	"/account/login",
	"/account/register",
	"/account/forgot-password",
	"/account/reset-password",
	"/account/reset-link-sent",
	"/account/reset-complete",
	"/account/verify-email",
	"/account/verify-email/result",
	"/account/change-password",
	"/account/settings/account",
	"/account/settings/security",
	"/account/settings/memory",
	"/account/federation/consent",
	"/account/federation/error",
	"/legal/terms",
	"/legal/privacy",
	"/api/auth/*",
	"/api/chat/conversations/:conversationId",
	"/api/chat/conversations/:conversationId/archive",
	"/api/chat/conversations/:conversationId/pin",
	"/api/chat/conversations/:conversationId/messages/:messageId/feedback",
	"/api/chat/conversations/:conversationId/messages/:messageId/trailing",
	"/api/chat/requests/:requestId",
	"/api/chat/requests/:requestId/events",
	"/api/chat/requests/:requestId/events/stream",
	"/api/chat/requests/:requestId/cancel",
	"/api/me/profile-memory/items/:itemId",
	"/api/notices",
	"/api/notices/:noticeId",
	"/api/notices/:noticeId/images/:ordinal",
] as const;

const SENSITIVE_IDENTIFIER =
	/\b(?:command|conversation|conv|item|message|msg|request|req|run)[_-][a-z0-9_-]+\b/giu;
const SENSITIVE_QUERY_VALUE = /([?&](?:code|token|resetToken|redirectTo|state)=)[^&#\s]*/giu;
const URL_WITH_QUERY = /(https?:\/\/[^\s?#]+)\?[^\s#]*/giu;

type SentrySpan = Parameters<NonNullable<CloudflareOptions["beforeSendSpan"]>>[0];
type SentryTransaction = Parameters<NonNullable<CloudflareOptions["beforeSendTransaction"]>>[0];
type SentryTraceContext = NonNullable<NonNullable<ErrorEvent["contexts"]>["trace"]>;

export function normalizeCampusTelemetryRoute(value: string | null | undefined): string {
	const pathname = pathnameFrom(value);
	for (const template of CAMPUS_ROUTE_TEMPLATES) {
		if (matchesRouteTemplate(pathname, template)) {
			return template;
		}
	}
	if (pathname.startsWith("/api/")) {
		return "/api/<unmatched>";
	}
	return "/<unmatched>";
}

export function sanitizeCampusSentryEvent(event: ErrorEvent): ErrorEvent {
	return sanitizeCampusSentryEventPayload(event);
}

export function sanitizeCampusSentryTransaction(event: SentryTransaction): SentryTransaction {
	return sanitizeCampusSentryEventPayload(event);
}

function sanitizeCampusSentryEventPayload<T extends ErrorEvent | SentryTransaction>(event: T): T {
	const method = event.request?.method?.toUpperCase();
	const route = normalizeCampusTelemetryRoute(event.request?.url ?? event.transaction);
	const exceptionType = normalizeExceptionType(event.exception?.values?.[0]?.type);
	event.request = { ...(method ? { method } : {}), url: route };
	event.transaction = route;
	delete event.extra;
	delete event.fingerprint;
	delete event.user;
	event.tags = Object.fromEntries(
		Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAGS.has(key)),
	);
	if (event.tags.route) {
		event.tags.route = normalizeCampusTelemetryRoute(String(event.tags.route));
	}
	event.contexts = event.contexts?.trace
		? { trace: sanitizeTraceContext(event.contexts.trace) }
		: {};
	if (event.spans) {
		event.spans = event.spans.map(sanitizeCampusSentrySpan);
	} else {
		delete event.spans;
	}
	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs
			.map((breadcrumb) => sanitizeCampusBreadcrumb(breadcrumb))
			.filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
	} else {
		delete event.breadcrumbs;
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

export function sanitizeCampusSentrySpan(span: SentrySpan): SentrySpan {
	const method = readSpanString(span.data, ["http.request.method", "http.method", "method"]);
	const route = normalizeCampusTelemetryRoute(
		readSpanString(span.data, ["http.route", "url.full", "url.path"]) ?? span.description,
	);
	const status = readSpanValue(span.data, ["http.response.status_code", "http.status_code"]);
	return {
		...span,
		data: {
			...(method ? { "http.request.method": method.toUpperCase() } : {}),
			"http.route": route,
			...(status === undefined ? {} : { "http.response.status_code": status }),
		},
		description: method ? `${method.toUpperCase()} ${route}` : route,
		links: [],
	};
}

export function sanitizeCampusBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
	const method =
		typeof breadcrumb.data?.method === "string" ? breadcrumb.data.method.toUpperCase() : undefined;
	const rawUrl =
		typeof breadcrumb.data?.url === "string"
			? breadcrumb.data.url
			: typeof breadcrumb.data?.to === "string"
				? breadcrumb.data.to
				: typeof breadcrumb.data?.from === "string"
					? breadcrumb.data.from
					: undefined;
	const status = breadcrumb.data?.status_code;
	const data = {
		...(method ? { method } : {}),
		...(rawUrl ? { url: normalizeCampusTelemetryRoute(rawUrl) } : {}),
		...(typeof status === "number" ? { status_code: status } : {}),
	};
	return {
		...(breadcrumb.category ? { category: breadcrumb.category } : {}),
		...(Object.keys(data).length > 0 ? { data } : {}),
		...(breadcrumb.level ? { level: breadcrumb.level } : {}),
		...(breadcrumb.timestamp === undefined ? {} : { timestamp: breadcrumb.timestamp }),
		...(breadcrumb.type ? { type: breadcrumb.type } : {}),
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
		.map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment)))
		.join("/");
	return new RegExp(`^${pattern}$`, "u").test(pathname);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
