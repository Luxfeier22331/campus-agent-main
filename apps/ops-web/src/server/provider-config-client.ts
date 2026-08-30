import type { z } from "zod";
import {
	EmbeddingModelSettingUpdateSchema,
	ExecutionModelSettingsStatusSchema,
	LLMModelSettingUpdateSchema,
	ModelDiscoveryRequestSchema,
	ModelDiscoveryResponseSchema,
	type ModelSettingKindSchema,
	type ModelSettingUpdate,
	RerankerModelSettingUpdateSchema,
} from "../shared/ops-contract.ts";

type ModelSettingKind = z.infer<typeof ModelSettingKindSchema>;

export interface ProviderConfigAdminEnv {
	MODEL_CONFIG_URL?: string;
}

export class ProviderConfigAdminUnavailableError extends Error {}

export class ProviderConfigAdminResponseError extends Error {
	readonly response: Response;
	readonly upstreamCode: string;
	readonly upstreamMessage: string;

	constructor(response: Response, upstreamCode = "model_settings_error", upstreamMessage = "") {
		super(`Model settings admin API returned HTTP ${response.status}.`);
		this.response = response;
		this.upstreamCode = upstreamCode;
		this.upstreamMessage = upstreamMessage;
	}
}

export function createProviderConfigAdminClient(
	env: ProviderConfigAdminEnv,
	input: { fetchImplementation?: typeof fetch } = {},
) {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const baseUrl = env.MODEL_CONFIG_URL?.trim().replace(/\/$/u, "");

	async function request(
		path: string,
		options: {
			actorId?: string;
			body?: unknown;
			method: "GET" | "POST" | "PUT";
		},
	) {
		if (!baseUrl) {
			throw new ProviderConfigAdminUnavailableError("Model settings admin API is not configured.");
		}
		let response: Response;
		try {
			response = await fetchImplementation(`${baseUrl}/internal/admin/model-configs${path}`, {
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
				headers: {
					...(options.actorId ? { "x-model-config-actor": options.actorId } : {}),
					...(options.body === undefined ? {} : { "content-type": "application/json" }),
				},
				method: options.method,
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new ProviderConfigAdminUnavailableError(
				error instanceof Error ? error.message : "Model settings admin API is unavailable.",
			);
		}
		const body = (await response.json().catch(() => null)) as unknown;
		if (!response.ok) {
			const upstream = providerConfigError(body);
			throw new ProviderConfigAdminResponseError(
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json; charset=utf-8" },
					status: response.status,
				}),
				upstream.code,
				upstream.message,
			);
		}
		return body;
	}

	return {
		discoverModels(
			body: z.input<typeof ModelDiscoveryRequestSchema>,
			actorId: string,
			kind: "llm" | "reranker" | "notice_classifier" = "llm",
		) {
			return request(`/${configNameForKind(kind)}/models`, {
				actorId,
				body: discoveryInput(ModelDiscoveryRequestSchema.parse(body)),
				method: "POST",
			}).then((response) => ModelDiscoveryResponseSchema.parse(discoveryResponse(response)));
		},
		async getStatus() {
			return ExecutionModelSettingsStatusSchema.parse(
				mapStatus(await request("", { method: "GET" })),
			);
		},
		async put(kind: ModelSettingKind, body: ModelSettingUpdate, actorId: string) {
			const parsed =
				kind === "embedding"
					? EmbeddingModelSettingUpdateSchema.parse(body)
					: kind === "reranker"
						? RerankerModelSettingUpdateSchema.parse(body)
						: LLMModelSettingUpdateSchema.parse(body);
			await request(`/${configNameForKind(kind)}`, {
				actorId,
				body: updateInput(kind, parsed),
				method: "PUT",
			});
			return ExecutionModelSettingsStatusSchema.parse(
				mapStatus(await request("", { method: "GET" })),
			);
		},
		async validate(kind: ModelSettingKind, actorId: string) {
			await request(`/${configNameForKind(kind)}/validate`, {
				actorId,
				method: "POST",
			});
			return ExecutionModelSettingsStatusSchema.parse(
				mapStatus(await request("", { method: "GET" })),
			);
		},
	};
}

const CONFIG_NAME_BY_KIND = {
	embedding: "campus_docs_embedding",
	llm: "primary_agent",
	reranker: "campus_docs_reranker",
	notice_classifier: "notice_classification",
} as const;

function configNameForKind(kind: ModelSettingKind) {
	return CONFIG_NAME_BY_KIND[kind];
}
function discoveryInput(input: z.infer<typeof ModelDiscoveryRequestSchema>) {
	return {
		...(input.apiKey ? { api_key: input.apiKey } : {}),
		base_url: input.baseUrl,
		provider: input.provider,
	};
}
function updateInput(kind: ModelSettingKind, input: ModelSettingUpdate) {
	if (kind === "embedding") {
		return {
			...(input.apiKey ? { api_key: input.apiKey } : {}),
			api_protocol: "openai.embeddings",
			base_url: input.baseUrl,
			provider: "openai-compatible",
			model: "Qwen3-Embedding-4B",
		};
	}
	if (kind === "reranker") {
		const reranker = input as z.infer<typeof RerankerModelSettingUpdateSchema>;
		return {
			...(reranker.apiKey ? { api_key: reranker.apiKey } : {}),
			api_protocol: "cohere.rerank",
			base_url: reranker.baseUrl,
			provider: reranker.provider,
			model: reranker.model,
		};
	}
	const text = input as z.infer<typeof LLMModelSettingUpdateSchema>;
	return {
		...(text.apiKey ? { api_key: text.apiKey } : {}),
		api_protocol: text.transport === "responses" ? "openai.responses" : "openai.chat_completions",
		base_url: text.baseUrl,
		provider: text.provider,
		model: text.model,
	};
}
function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function discoveryResponse(value: unknown) {
	const raw = asRecord(value);
	return { models: raw.models, sampledAt: raw.sampled_at };
}
function mapStatus(value: unknown) {
	const raw = asRecord(value);
	const configs = asRecord(raw.configs);
	const setting = (kind: ModelSettingKind) => {
		const config = configs[configNameForKind(kind)];
		if (!config) {
			return null;
		}
		const b = asRecord(config);
		const rawValidation = b.validation;
		const validation =
			rawValidation && typeof rawValidation === "object" && !Array.isArray(rawValidation)
				? asRecord(rawValidation)
				: null;
		const hasCompleteValidation =
			validation !== null &&
			(validation.status === "passed" || validation.status === "failed") &&
			typeof validation.message === "string" &&
			typeof b.validated_at === "string" &&
			typeof b.validated_by === "string";
		return {
			baseUrl: b.base_url,
			credentialConfigured: b.credential_configured,
			kind,
			latestValidation: hasCompleteValidation
				? {
						...(typeof validation.error_code === "string" && validation.error_code
							? { errorCode: validation.error_code }
							: {}),
						message: validation.message,
						...(typeof validation.observed_dimensions === "number" &&
						validation.observed_dimensions > 0
							? { observedDimensions: validation.observed_dimensions }
							: {}),
						status: validation.status,
						validatedAt: b.validated_at,
						validatedBy: b.validated_by,
					}
				: null,
			model: b.model,
			provider: b.provider,
			transport:
				b.api_protocol === "openai.responses"
					? "responses"
					: b.api_protocol === "openai.chat_completions"
						? "chat_completions"
						: b.api_protocol === "cohere.rerank"
							? "rerank"
							: "embeddings",
			updatedAt: b.updated_at,
			updatedBy: b.updated_by,
		};
	};
	return {
		embeddingContract: {
			dimensions: 2560,
			model: "Qwen3-Embedding-4B",
			provider: "openai-compatible",
			transport: "embeddings",
		},
		sampledAt: raw.sampled_at,
		settings: {
			embedding: setting("embedding"),
			llm: setting("llm"),
			reranker: setting("reranker"),
			notice_classifier: setting("notice_classifier"),
		},
	};
}

function providerConfigError(body: unknown) {
	const record = asRecord(body);
	const nested = asRecord(record.error);
	const code =
		typeof nested.code === "string"
			? nested.code
			: typeof record.error_code === "string"
				? record.error_code
				: "model_settings_error";
	const message =
		typeof nested.message === "string"
			? nested.message
			: typeof record.message === "string"
				? record.message
				: "";
	return { code, message };
}
