import { z } from "zod";

import {
	type OpsSentryIssuesResponse,
	OpsSentryIssuesResponseSchema,
} from "../shared/ops-contract.ts";
import { resolveRequestObservabilityWindow } from "./request-observability-window.ts";

const SENTRY_QUERY_LIMIT = 5;
const SENTRY_FETCH_LIMIT = SENTRY_QUERY_LIMIT + 1;
const SENTRY_QUERY_TIMEOUT_MS = 30_000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const SentryIssueSchema = z
	.object({
		count: z.union([z.string(), z.number()]),
		firstSeen: z.string().datetime(),
		id: z.string().min(1),
		lastSeen: z.string().datetime(),
		level: z.string().min(1).nullable().optional(),
		permalink: z.string().url(),
		project: z.object({
			name: z.string().min(1),
			slug: z.string().min(1),
		}),
		shortId: z.string().min(1),
		status: z.string().min(1),
		title: z.string().min(1),
	})
	.passthrough();

const SentryIssuesSchema = z.array(SentryIssueSchema);

export interface SentryQueryInput {
	completedAt: string | null;
	now?: Date;
	requestId: string;
	signal?: AbortSignal;
	startedAt: string;
	traceId: string;
}

export interface SentryClient {
	queryRequestIssues(input: SentryQueryInput): Promise<OpsSentryIssuesResponse>;
}

export interface SentryEnv {
	DEPLOYMENT_ENVIRONMENT?: string;
	OPS_WEB_SENTRY_BASE_URL?: string;
	OPS_WEB_SENTRY_EVENT_READ_TOKEN?: string;
	OPS_WEB_SENTRY_ORG_SLUG?: string;
	OPS_WEB_SENTRY_PROJECT_SLUGS?: string;
}

export class SentryUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SentryUnavailableError";
	}
}

export function createSentryClient(input: {
	baseUrl: string;
	environment: string;
	fetchFn?: typeof fetch;
	orgSlug: string;
	projectSlugs: string[];
	token: string;
}): SentryClient {
	const baseUrl = normalizeSentryBaseUrl(input.baseUrl);
	const environment = normalizeEnvironment(input.environment);
	const orgSlug = normalizeSlug(input.orgSlug, "organization");
	const projectSlugs = normalizeProjectSlugs(input.projectSlugs);
	const token = normalizeToken(input.token);
	const fetchFn = input.fetchFn ?? fetch;

	return {
		async queryRequestIssues(queryInput) {
			const requestId = normalizeRequestId(queryInput.requestId);
			const now = queryInput.now ?? new Date();
			let window: ReturnType<typeof resolveRequestObservabilityWindow>;
			try {
				window = resolveRequestObservabilityWindow(queryInput, now);
			} catch (error) {
				throw new SentryUnavailableError("Sentry query received an invalid request time range.", {
					cause: error,
				});
			}
			const searchQuery = `campus.request_id:${JSON.stringify(requestId)}`;
			const url = new URL(`/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/`, baseUrl);
			for (const projectSlug of projectSlugs) {
				url.searchParams.append("project", projectSlug);
			}
			url.searchParams.set("environment", environment);
			url.searchParams.set("start", window.from.toISOString());
			url.searchParams.set("end", window.to.toISOString());
			url.searchParams.set("query", searchQuery);
			url.searchParams.set("sort", "date");
			url.searchParams.set("limit", String(SENTRY_FETCH_LIMIT));

			const startedAt = Date.now();
			let response: Response;
			try {
				const timeoutSignal = AbortSignal.timeout(SENTRY_QUERY_TIMEOUT_MS);
				response = await fetchFn(url, {
					headers: {
						accept: "application/json",
						authorization: `Bearer ${token}`,
					},
					method: "GET",
					signal: queryInput.signal
						? AbortSignal.any([queryInput.signal, timeoutSignal])
						: timeoutSignal,
				});
			} catch (error) {
				throw new SentryUnavailableError("Sentry issues query failed.", { cause: error });
			}
			if (!response.ok) {
				throw new SentryUnavailableError(`Sentry issues query returned HTTP ${response.status}.`);
			}
			let value: unknown;
			try {
				value = await response.json();
			} catch (error) {
				throw new SentryUnavailableError("Sentry returned invalid JSON.", { cause: error });
			}
			const parsed = SentryIssuesSchema.safeParse(value);
			if (!parsed.success) {
				throw new SentryUnavailableError("Sentry returned an invalid issues response.");
			}
			const issues = parsed.data.slice(0, SENTRY_QUERY_LIMIT).map((issue) => ({
				eventCount: normalizeEventCount(issue.count),
				firstSeen: issue.firstSeen,
				issueId: issue.id,
				lastSeen: issue.lastSeen,
				level: issue.level ?? null,
				permalink: normalizePermalink(issue.permalink, baseUrl),
				projectName: issue.project.name,
				projectSlug: issue.project.slug,
				shortId: issue.shortId,
				status: issue.status,
				title: issue.title,
			}));
			return OpsSentryIssuesResponseSchema.parse({
				dataState: issues.length === 0 ? "NO_DATA" : "FRESH",
				from: window.from.toISOString(),
				issues,
				limit: SENTRY_QUERY_LIMIT,
				queriedAt: now.toISOString(),
				queryDurationMs: Math.max(0, Date.now() - startedAt),
				requestId,
				searchQuery,
				source: "SENTRY",
				to: window.to.toISOString(),
				traceId: queryInput.traceId,
				truncated: parsed.data.length > SENTRY_QUERY_LIMIT || window.clamped,
			});
		},
	};
}

export function createSentryClientFromEnv(env: SentryEnv = process.env): SentryClient {
	const required = {
		DEPLOYMENT_ENVIRONMENT: env.DEPLOYMENT_ENVIRONMENT?.trim(),
		OPS_WEB_SENTRY_BASE_URL: env.OPS_WEB_SENTRY_BASE_URL?.trim(),
		OPS_WEB_SENTRY_EVENT_READ_TOKEN: env.OPS_WEB_SENTRY_EVENT_READ_TOKEN?.trim(),
		OPS_WEB_SENTRY_ORG_SLUG: env.OPS_WEB_SENTRY_ORG_SLUG?.trim(),
		OPS_WEB_SENTRY_PROJECT_SLUGS: env.OPS_WEB_SENTRY_PROJECT_SLUGS?.trim(),
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);
	if (missing.length > 0) {
		throw new SentryUnavailableError(`Sentry configuration is missing: ${missing.join(", ")}.`);
	}
	return createSentryClient({
		baseUrl: required.OPS_WEB_SENTRY_BASE_URL as string,
		environment: required.DEPLOYMENT_ENVIRONMENT as string,
		orgSlug: required.OPS_WEB_SENTRY_ORG_SLUG as string,
		projectSlugs: (required.OPS_WEB_SENTRY_PROJECT_SLUGS as string).split(","),
		token: required.OPS_WEB_SENTRY_EVENT_READ_TOKEN as string,
	});
}

export function sentryTraceExplorerUrl(input: { baseUrl?: string; orgSlug?: string }) {
	if (!(input.baseUrl?.trim() && input.orgSlug?.trim())) {
		return null;
	}
	try {
		const baseUrl = normalizeSentryBaseUrl(input.baseUrl);
		const orgSlug = normalizeSlug(input.orgSlug, "organization");
		return new URL(
			`/orgredirect/organizations/${encodeURIComponent(orgSlug)}/traces/`,
			baseUrl,
		).toString();
	} catch {
		return null;
	}
}

function normalizeSentryBaseUrl(value: string) {
	const parsed = new URL(value);
	if (
		parsed.protocol !== "https:" ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		(parsed.pathname !== "/" && parsed.pathname !== "")
	) {
		throw new Error("Sentry base URL must be an HTTPS origin.");
	}
	return `${parsed.origin}/`;
}

function normalizeSlug(value: string, label: string) {
	const normalized = value.trim().toLowerCase();
	if (!SLUG_PATTERN.test(normalized)) {
		throw new Error(`Sentry ${label} slug is invalid.`);
	}
	return normalized;
}

function normalizeProjectSlugs(values: string[]) {
	const normalized = [...new Set(values.map((value) => normalizeSlug(value, "project")))];
	if (normalized.length === 0 || normalized.length > 10) {
		throw new Error("Sentry project slugs are invalid.");
	}
	return normalized;
}

function normalizeEnvironment(value: string) {
	const normalized = value.trim();
	if (!normalized || normalized.length > 64 || /[\r\n]/.test(normalized)) {
		throw new Error("Sentry environment is invalid.");
	}
	return normalized;
}

function normalizeRequestId(value: string) {
	const normalized = value.trim();
	if (!REQUEST_ID_PATTERN.test(normalized)) {
		throw new SentryUnavailableError("Sentry request ID is invalid.");
	}
	return normalized;
}

function normalizeToken(value: string) {
	const normalized = value.trim();
	if (!normalized || /[\r\n]/.test(normalized)) {
		throw new Error("Sentry event read token is invalid.");
	}
	return normalized;
}

function normalizeEventCount(value: string | number) {
	const parsed =
		typeof value === "number"
			? value
			: /^\d+$/u.test(value)
				? Number.parseInt(value, 10)
				: Number.NaN;
	if (!(Number.isSafeInteger(parsed) && parsed >= 0)) {
		throw new SentryUnavailableError("Sentry returned an invalid issue event count.");
	}
	return parsed;
}

function normalizePermalink(value: string, baseUrl: string) {
	const parsed = new URL(value);
	if (parsed.protocol !== "https:" || parsed.origin !== new URL(baseUrl).origin) {
		throw new SentryUnavailableError("Sentry returned an invalid issue permalink.");
	}
	return parsed.toString();
}
