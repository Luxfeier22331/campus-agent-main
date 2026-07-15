export interface FeedWeProviderConfig {
	apiKey?: string;
	baseUrl: string;
	email?: string;
	password?: string;
}

export interface FeedWeHistoryRequest {
	begin: string;
	names: string;
	size: number;
}

export interface FeedWeHistoryPage {
	articles: unknown[];
	begin: string;
	count: number;
	hasMore: boolean;
	raw: Record<string, unknown>;
	size: number;
	total: number | null;
}

export interface FeedWeAuthenticatedSession {
	raw: Record<string, unknown>;
	token: string;
	user: {
		email: string | null;
		id: string | null;
		raw: Record<string, unknown>;
	};
}

export interface FeedWeAuthMe {
	raw: Record<string, unknown>;
	user: {
		email: string | null;
		id: string | null;
		isActive: boolean | null;
		subscriptionCount: number | null;
		raw: Record<string, unknown>;
	};
}

export interface FeedWeSubscription {
	id: string | null;
	raw: Record<string, unknown>;
	wechatAccount: {
		alias: string | null;
		id: string;
		name: string | null;
		nickname: string | null;
		raw: Record<string, unknown>;
	};
	wechatAccountId: string;
}

export interface FeedWeArticlesRequest {
	accountId: string;
	cursor?: string | null;
	limit: number;
}

export interface FeedWeArticlesPage {
	articles: unknown[];
	pagination: {
		hasMore: boolean;
		nextCursor: string | null;
		total: number | null;
	};
	raw: Record<string, unknown>;
}

export class FeedWeRequestError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(input: { code: string; message: string; status: number }) {
		super(input.message);
		this.name = "FeedWeRequestError";
		this.code = input.code;
		this.status = input.status;
	}
}

export async function fetchFeedWeHistoryPage(input: {
	abortSignal?: AbortSignal;
	fetchImplementation: typeof fetch;
	provider: FeedWeProviderConfig;
	request: FeedWeHistoryRequest;
}): Promise<FeedWeHistoryPage> {
	const apiKey = normalizeRequiredSecret(input.provider.apiKey, "FeedWe API key");
	const raw = await requestFeedWeJson({
		abortSignal: input.abortSignal,
		fetchImplementation: input.fetchImplementation,
		headers: {
			"x-api-key": apiKey,
		},
		method: "GET",
		path: "/api/v1/articles/history",
		provider: input.provider,
		query: {
			begin: input.request.begin,
			names: input.request.names,
			size: String(input.request.size),
		},
	});
	if (!isRecord(raw)) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe history response must be a JSON object.",
			status: 502,
		});
	}
	return normalizeFeedWeHistoryPage(raw);
}

export async function loginFeedWe(input: {
	abortSignal?: AbortSignal;
	fetchImplementation: typeof fetch;
	provider: FeedWeProviderConfig;
}): Promise<FeedWeAuthenticatedSession> {
	const email = normalizeRequiredSecret(input.provider.email, "FeedWe email");
	const password = normalizeRequiredSecret(input.provider.password, "FeedWe password");
	const raw = await requestFeedWeJson({
		abortSignal: input.abortSignal,
		body: {
			email,
			password,
		},
		fetchImplementation: input.fetchImplementation,
		method: "POST",
		path: "/api/auth/login",
		provider: input.provider,
	});
	if (!isRecord(raw)) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe login response must be a JSON object.",
			status: 502,
		});
	}
	const token = normalizeNullableString(raw.token);
	if (!token) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe login response must include a token.",
			status: 502,
		});
	}
	const user = isRecord(raw.user) ? raw.user : {};
	return {
		raw,
		token,
		user: {
			email: normalizeNullableString(user.email),
			id: normalizeNullableString(user.id),
			raw: user,
		},
	};
}

export async function fetchFeedWeAuthMe(input: {
	abortSignal?: AbortSignal;
	fetchImplementation: typeof fetch;
	provider: FeedWeProviderConfig;
	token: string;
}): Promise<FeedWeAuthMe> {
	const raw = await requestFeedWeJson({
		abortSignal: input.abortSignal,
		authToken: input.token,
		fetchImplementation: input.fetchImplementation,
		method: "GET",
		path: "/api/auth/me",
		provider: input.provider,
	});
	if (!isRecord(raw)) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe auth/me response must be a JSON object.",
			status: 502,
		});
	}
	const user = isRecord(raw.user) ? raw.user : raw;
	return {
		raw,
		user: {
			email: normalizeNullableString(user.email),
			id: normalizeNullableString(user.id),
			isActive: normalizeNullableBoolean(user.isActive),
			raw: user,
			subscriptionCount: normalizeNullableInteger(user.subscriptionCount),
		},
	};
}

export async function fetchFeedWeSubscriptions(input: {
	abortSignal?: AbortSignal;
	fetchImplementation: typeof fetch;
	provider: FeedWeProviderConfig;
	token: string;
}): Promise<FeedWeSubscription[]> {
	const raw = await requestFeedWeJson({
		abortSignal: input.abortSignal,
		authToken: input.token,
		fetchImplementation: input.fetchImplementation,
		method: "GET",
		path: "/api/subscriptions",
		provider: input.provider,
	});
	const records = Array.isArray(raw)
		? raw
		: isRecord(raw) && Array.isArray(raw.subscriptions)
			? raw.subscriptions
			: null;
	if (!records) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe subscriptions response must be an array.",
			status: 502,
		});
	}
	return records.map((item) => normalizeFeedWeSubscription(item));
}

export async function fetchFeedWeArticlesPage(input: {
	abortSignal?: AbortSignal;
	fetchImplementation: typeof fetch;
	provider: FeedWeProviderConfig;
	request: FeedWeArticlesRequest;
	token: string;
}): Promise<FeedWeArticlesPage> {
	const raw = await requestFeedWeJson({
		abortSignal: input.abortSignal,
		authToken: input.token,
		fetchImplementation: input.fetchImplementation,
		method: "GET",
		path: "/api/articles",
		provider: input.provider,
		query: {
			accountId: input.request.accountId,
			...(input.request.cursor ? { cursor: input.request.cursor } : {}),
			limit: String(input.request.limit),
		},
	});
	if (!isRecord(raw)) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe articles response must be a JSON object.",
			status: 502,
		});
	}
	return normalizeFeedWeArticlesPage(raw);
}

export function resolveFeedWeSubscription(input: {
	accountName: string;
	accountSlug: string;
	subscriptions: FeedWeSubscription[];
}): FeedWeSubscription {
	if (input.subscriptions.length === 0) {
		throw new FeedWeRequestError({
			code: "provider_not_found",
			message: `FeedWe subscription not found for account ${input.accountName}.`,
			status: 404,
		});
	}
	const targetValues = new Set(
		[input.accountName, input.accountSlug].map(normalizeLookupKey).filter(Boolean),
	);
	const matches = input.subscriptions.filter((subscription) => {
		const candidates = [
			subscription.wechatAccount.name,
			subscription.wechatAccount.alias,
			subscription.wechatAccount.nickname,
			subscription.wechatAccountId,
			subscription.wechatAccount.id,
		]
			.map(normalizeLookupKey)
			.filter(Boolean);
		return candidates.some((candidate) => targetValues.has(candidate));
	});
	if (matches.length === 1) {
		return matches[0];
	}
	if (matches.length > 1) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: `FeedWe subscription match is ambiguous for account ${input.accountName}.`,
			status: 502,
		});
	}
	if (input.subscriptions.length === 1) {
		return input.subscriptions[0];
	}
	throw new FeedWeRequestError({
		code: "provider_not_found",
		message: `FeedWe subscription not found for account ${input.accountName}.`,
		status: 404,
	});
}

export function normalizeFeedWeHistoryPage(raw: Record<string, unknown>): FeedWeHistoryPage {
	const articles = Array.isArray(raw.articles) ? raw.articles : [];
	const size = normalizeInteger(raw.size, articles.length);
	const count = normalizeInteger(raw.count, articles.length);
	return {
		articles,
		begin: typeof raw.begin === "string" ? raw.begin : String(raw.begin ?? "0"),
		count,
		hasMore: Boolean(raw.hasMore),
		raw,
		size,
		total: raw.total == null ? null : normalizeInteger(raw.total, 0),
	};
}

export function normalizeFeedWeArticlesPage(raw: Record<string, unknown>): FeedWeArticlesPage {
	const articles = Array.isArray(raw.articles) ? raw.articles : [];
	const pagination = isRecord(raw.pagination) ? raw.pagination : raw;
	return {
		articles,
		pagination: {
			hasMore: Boolean(pagination.hasMore),
			nextCursor: normalizeNullableString(pagination.nextCursor),
			total: pagination.total == null ? null : normalizeInteger(pagination.total, 0),
		},
		raw,
	};
}

function normalizeFeedWeSubscription(value: unknown): FeedWeSubscription {
	if (!isRecord(value)) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe subscription row must be a JSON object.",
			status: 502,
		});
	}
	const wechatAccount = isRecord(value.wechatAccount) ? value.wechatAccount : {};
	const wechatAccountId =
		normalizeNullableString(value.wechatAccountId) ??
		normalizeNullableString(wechatAccount.id) ??
		"";
	if (!wechatAccountId) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe subscription row must include wechatAccountId.",
			status: 502,
		});
	}
	return {
		id: normalizeNullableString(value.id),
		raw: value,
		wechatAccount: {
			alias: normalizeNullableString(wechatAccount.alias),
			id: normalizeNullableString(wechatAccount.id) ?? wechatAccountId,
			name: normalizeNullableString(wechatAccount.name),
			nickname: normalizeNullableString(wechatAccount.nickname),
			raw: wechatAccount,
		},
		wechatAccountId,
	};
}

async function requestFeedWeJson(input: {
	abortSignal?: AbortSignal;
	authToken?: string;
	body?: Record<string, unknown>;
	fetchImplementation: typeof fetch;
	headers?: Record<string, string>;
	method: "GET" | "POST";
	path: string;
	provider: FeedWeProviderConfig;
	query?: Record<string, string>;
}): Promise<unknown> {
	input.abortSignal?.throwIfAborted();
	const url = new URL(input.path, normalizeBaseUrl(input.provider.baseUrl));
	for (const [key, value] of Object.entries(input.query ?? {})) {
		url.searchParams.set(key, value);
	}

	let response: Response;
	try {
		response = await input.fetchImplementation(url.toString(), {
			body: input.body ? JSON.stringify(input.body) : undefined,
			headers: {
				...(input.body ? { "content-type": "application/json" } : {}),
				...(input.authToken ? { Authorization: `Bearer ${input.authToken}` } : {}),
				...input.headers,
			},
			method: input.method,
			signal: input.abortSignal,
		});
	} catch (error) {
		input.abortSignal?.throwIfAborted();
		throw new FeedWeRequestError({
			code: "provider_unavailable",
			message: error instanceof Error ? error.message : "FeedWe request failed.",
			status: 502,
		});
	}

	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		input.abortSignal?.throwIfAborted();
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe response must be valid JSON.",
			status: 502,
		});
	}
	input.abortSignal?.throwIfAborted();
	if (!response.ok) {
		throw new FeedWeRequestError({
			code: "provider_http_error",
			message: `FeedWe request failed with HTTP ${response.status}.`,
			status: response.status,
		});
	}
	if (raw == null) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe response must be valid JSON.",
			status: 502,
		});
	}
	return raw;
}

function normalizeBaseUrl(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new FeedWeRequestError({
			code: "provider_config_invalid",
			message: "FeedWe base URL is required.",
			status: 500,
		});
	}
	return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeInteger(value: unknown, defaultValue: number): number {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return defaultValue;
}

function normalizeNullableInteger(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return null;
}

function normalizeNullableBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequiredSecret(value: unknown, field: string): string {
	const normalized = normalizeNullableString(value);
	if (!normalized) {
		throw new FeedWeRequestError({
			code: "provider_config_invalid",
			message: `${field} is required.`,
			status: 500,
		});
	}
	return normalized;
}

function normalizeLookupKey(value: string | null): string {
	return (
		value
			?.normalize("NFKC")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "_")
			.replace(/^_+|_+$/g, "")
			.replace(/_+/g, "_") ?? ""
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
