import { LangfuseClient } from "@langfuse/client";

import { listPaginated, requestJson } from "./http";
import type { JsonObject } from "./json";
import type { LangfuseSettings } from "./settings";

export interface LangfuseEvalClient {
	createDataset(input: JsonObject): Promise<JsonObject>;
	createDatasetItem(input: JsonObject): Promise<JsonObject>;
	createDatasetRunItem(input: JsonObject): Promise<JsonObject>;
	createScore(input: JsonObject): Promise<void>;
	createScoreConfig(input: JsonObject): Promise<JsonObject>;
	getDataset(name: string, options?: { version?: string | null }): Promise<JsonObject>;
	getTrace(traceId: string, query?: Record<string, unknown>): Promise<JsonObject>;
	listDatasets(): Promise<JsonObject[]>;
	listScoreConfigs(): Promise<JsonObject[]>;
	listTraces(query?: Record<string, unknown>): Promise<JsonObject[]>;
}

export function createLangfuseEvalClient(input: {
	fetchImpl?: typeof fetch;
	settings: LangfuseSettings;
}): LangfuseEvalClient {
	if (input.fetchImpl) {
		return new RestLangfuseEvalClient(input.settings, input.fetchImpl);
	}
	return new SdkLangfuseEvalClient(input.settings);
}

class SdkLangfuseEvalClient implements LangfuseEvalClient {
	private readonly client: LangfuseClient;
	private readonly rest: RestLangfuseEvalClient;

	constructor(settings: LangfuseSettings) {
		this.client = new LangfuseClient({
			baseUrl: settings.baseUrl,
			publicKey: settings.publicKey,
			secretKey: settings.secretKey,
			...(settings.timeoutSeconds === undefined ? {} : { timeout: settings.timeoutSeconds }),
		});
		this.rest = new RestLangfuseEvalClient(settings);
	}

	async createDataset(input: JsonObject): Promise<JsonObject> {
		return (await this.client.api.datasets.create(input as never)) as unknown as JsonObject;
	}

	async createDatasetItem(input: JsonObject): Promise<JsonObject> {
		return (await this.client.api.datasetItems.create(input as never)) as unknown as JsonObject;
	}

	async createDatasetRunItem(input: JsonObject): Promise<JsonObject> {
		return (await this.client.api.datasetRunItems.create(input as never)) as unknown as JsonObject;
	}

	async createScore(input: JsonObject): Promise<void> {
		await this.rest.createScore(input);
	}

	async createScoreConfig(input: JsonObject): Promise<JsonObject> {
		return (await this.client.api.scoreConfigs.create(input as never)) as unknown as JsonObject;
	}

	async getDataset(name: string, options?: { version?: string | null }): Promise<JsonObject> {
		return (await this.client.dataset.get(
			name,
			options?.version ? { version: options.version } : {},
		)) as unknown as JsonObject;
	}

	async getTrace(traceId: string, query?: Record<string, unknown>): Promise<JsonObject> {
		if (query && Object.keys(query).length > 0) {
			return this.rest.getTrace(traceId, query);
		}
		return (await this.client.api.trace.get(traceId)) as unknown as JsonObject;
	}

	async listDatasets(): Promise<JsonObject[]> {
		return listSdkPaginated((query) => this.client.api.datasets.list(query as never));
	}

	async listScoreConfigs(): Promise<JsonObject[]> {
		return listSdkPaginated((query) => this.client.api.scoreConfigs.get(query as never));
	}

	async listTraces(query?: Record<string, unknown>): Promise<JsonObject[]> {
		return listSdkPaginated((pageQuery) =>
			this.client.api.trace.list({ ...(query ?? {}), ...pageQuery } as never),
		);
	}
}

class RestLangfuseEvalClient implements LangfuseEvalClient {
	private readonly fetchImpl: typeof fetch | undefined;
	private readonly settings: LangfuseSettings;

	constructor(settings: LangfuseSettings, fetchImpl?: typeof fetch) {
		this.settings = settings;
		this.fetchImpl = fetchImpl;
	}

	async createDataset(input: JsonObject): Promise<JsonObject> {
		return this.restRequest({
			body: input,
			method: "POST",
			path: "/api/public/v2/datasets",
		});
	}

	async createDatasetItem(input: JsonObject): Promise<JsonObject> {
		return this.restRequest({
			body: input,
			method: "POST",
			path: "/api/public/dataset-items",
		});
	}

	async createDatasetRunItem(input: JsonObject): Promise<JsonObject> {
		return this.restRequest({
			body: input,
			method: "POST",
			path: "/api/public/dataset-run-items",
		});
	}

	async createScore(input: JsonObject): Promise<void> {
		await this.restRequest({
			body: input,
			method: "POST",
			path: "/api/public/scores",
		});
	}

	async createScoreConfig(input: JsonObject): Promise<JsonObject> {
		return this.restRequest({
			body: input,
			method: "POST",
			path: "/api/public/score-configs",
		});
	}

	async getDataset(name: string, options?: { version?: string | null }): Promise<JsonObject> {
		return this.restRequest({
			method: "GET",
			path: `/api/public/datasets/${encodeURIComponent(name)}`,
			query: { version: options?.version ?? undefined },
		});
	}

	async getTrace(traceId: string, query?: Record<string, unknown>): Promise<JsonObject> {
		return this.restRequest({
			method: "GET",
			path: `/api/public/traces/${traceId}`,
			...(query ? { query } : {}),
		});
	}

	async listDatasets(): Promise<JsonObject[]> {
		return listPaginated({
			...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
			path: "/api/public/v2/datasets",
			settings: this.settings,
		});
	}

	async listScoreConfigs(): Promise<JsonObject[]> {
		return listPaginated({
			...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
			path: "/api/public/score-configs",
			settings: this.settings,
		});
	}

	async listTraces(query?: Record<string, unknown>): Promise<JsonObject[]> {
		return listPaginated({
			...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
			path: "/api/public/traces",
			...(query ? { query } : {}),
			settings: this.settings,
		});
	}

	private async restRequest(input: {
		body?: JsonObject;
		method: string;
		path: string;
		query?: Record<string, unknown>;
	}): Promise<JsonObject> {
		return requestJson({
			...(input.body ? { body: input.body } : {}),
			...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
			method: input.method,
			path: input.path,
			...(input.query ? { query: input.query } : {}),
			settings: this.settings,
		});
	}
}

async function listSdkPaginated(
	fetchPage: (query: Record<string, unknown>) => Promise<unknown>,
): Promise<JsonObject[]> {
	const items: JsonObject[] = [];
	for (let page = 1; ; page += 1) {
		const payload = (await fetchPage({ limit: 50, page })) as JsonObject;
		const data = Array.isArray(payload.data) ? payload.data : [];
		items.push(...data.filter(isJsonObject));
		const meta = isJsonObject(payload.meta) ? payload.meta : {};
		const totalPages = Number(meta.totalPages ?? meta.total_pages ?? page);
		if (page >= totalPages) {
			return items;
		}
	}
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
