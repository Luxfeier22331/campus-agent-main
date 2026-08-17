import { isRecord, type JsonObject, mappingList } from "./json";
import { assertCompleteSettings, type LangfuseSettings } from "./settings";

export class LangfuseRequestError extends Error {
	readonly statusCode: number;

	constructor(statusCode: number, message: string) {
		super(`Langfuse request failed: ${statusCode} ${message}`);
		this.statusCode = statusCode;
	}
}

export function basicAuth(publicKey: string, secretKey: string): string {
	return `Basic ${Buffer.from(`${publicKey.trim()}:${secretKey.trim()}`).toString("base64")}`;
}

export async function requestJson(input: {
	body?: JsonObject;
	fetchImpl?: typeof fetch;
	method: string;
	path: string;
	query?: Record<string, unknown>;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	assertCompleteSettings(input.settings);
	const fetchImpl = input.fetchImpl ?? fetch;
	const url = new URL(`${input.settings.baseUrl.trim().replace(/\/+$/u, "")}${input.path}`);
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}
	const response = await fetchImpl(url, {
		...(input.body ? { body: JSON.stringify(input.body) } : {}),
		headers: {
			authorization: basicAuth(input.settings.publicKey, input.settings.secretKey),
			...(input.body ? { "content-type": "application/json" } : {}),
		},
		method: input.method,
	});
	if (response.status >= 400) {
		throw new LangfuseRequestError(response.status, await response.text());
	}
	const text = await response.text();
	if (!text.trim()) {
		return {};
	}
	const payload = JSON.parse(text) as unknown;
	if (!isRecord(payload)) {
		throw new Error("Langfuse response must be a JSON object");
	}
	return payload;
}

export async function listPaginated(input: {
	fetchImpl?: typeof fetch;
	path: string;
	query?: Record<string, unknown>;
	settings: LangfuseSettings;
}): Promise<JsonObject[]> {
	const items: JsonObject[] = [];
	for (let page = 1; ; page += 1) {
		const payload = await requestJson({
			...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
			method: "GET",
			path: input.path,
			query: { ...(input.query ?? {}), limit: 50, page },
			settings: input.settings,
		});
		items.push(...mappingList(payload.data, "data"));
		const meta = isRecord(payload.meta) ? payload.meta : {};
		const totalPages = Number(meta.totalPages ?? meta.total_pages ?? page);
		if (page >= totalPages) {
			return items;
		}
	}
}
