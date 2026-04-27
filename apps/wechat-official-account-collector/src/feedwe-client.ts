export interface FeedWeProviderConfig {
	apiKey: string;
	baseUrl: string;
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
	fetchImplementation: typeof fetch;
	provider: FeedWeProviderConfig;
	request: FeedWeHistoryRequest;
}): Promise<FeedWeHistoryPage> {
	const url = new URL("/api/v1/articles/history", normalizeBaseUrl(input.provider.baseUrl));
	url.searchParams.set("names", input.request.names);
	url.searchParams.set("begin", input.request.begin);
	url.searchParams.set("size", String(input.request.size));

	let response: Response;
	try {
		response = await input.fetchImplementation(url.toString(), {
			headers: {
				"x-api-key": input.provider.apiKey,
			},
			method: "GET",
		});
	} catch (error) {
		throw new FeedWeRequestError({
			code: "provider_unavailable",
			message: error instanceof Error ? error.message : "FeedWe request failed.",
			status: 502,
		});
	}

	const raw = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) {
		throw new FeedWeRequestError({
			code: "provider_http_error",
			message: `FeedWe history request failed with HTTP ${response.status}.`,
			status: response.status,
		});
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new FeedWeRequestError({
			code: "provider_response_invalid",
			message: "FeedWe history response must be a JSON object.",
			status: 502,
		});
	}

	return normalizeFeedWeHistoryPage(raw as Record<string, unknown>);
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

function normalizeInteger(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return fallback;
}
