import { CANONICAL_EMBEDDING_MODEL, EMBEDDING_SPACE } from "./definitions.ts";
import type { EmbeddingClient, EmbeddingConnection } from "./types.ts";

export const EMBEDDING_MODEL_CONFIG_URL = "http://model-config:8000";
export const EMBEDDING_BATCH_SIZE = 8;
export const EMBEDDING_REQUEST_CONCURRENCY = 8;

export async function fetchEmbeddingConnection(
	fetchImpl: typeof fetch = fetch,
	modelConfigUrl = process.env.MODEL_CONFIG_URL ?? EMBEDDING_MODEL_CONFIG_URL,
): Promise<EmbeddingConnection> {
	const baseUrl = modelConfigUrl.replace(/\/$/u, "");
	const response = await fetchImpl(`${baseUrl}/internal/model-configs/campus_docs_embedding`, {
		headers: { accept: "application/json" },
		method: "GET",
		redirect: "error",
	});
	if (!response.ok) {
		throw new Error(`embedding model config returned HTTP ${response.status}`);
	}
	const payload = (await response.json()) as unknown;
	if (
		!isRecord(payload) ||
		payload.schema_version !== "model_runtime_config.v1" ||
		payload.name !== "campus_docs_embedding" ||
		payload.provider !== "openai-compatible" ||
		payload.api_protocol !== "openai.embeddings" ||
		!nonEmptyString(payload.base_url) ||
		payload.model !== CANONICAL_EMBEDDING_MODEL ||
		!nonEmptyString(payload.api_key) ||
		typeof payload.target_sha256 !== "string" ||
		!/^[0-9a-f]{64}$/u.test(payload.target_sha256)
	) {
		throw new Error("embedding model runtime config is invalid");
	}
	return createEmbeddingConnection({
		apiKey: payload.api_key,
		baseUrl: payload.base_url,
		model: payload.model,
		targetSha256: payload.target_sha256,
	});
}

export function createEmbeddingConnection(input: {
	apiKey: string;
	baseUrl: string;
	model: string;
	targetSha256: string;
}): EmbeddingConnection {
	const apiKey = input.apiKey.trim();
	const baseUrl = input.baseUrl.trim().replace(/\/+$/u, "");
	const model = input.model.trim();
	const targetSha256 = input.targetSha256;
	if (!apiKey || !baseUrl || !model || !/^[0-9a-f]{64}$/u.test(targetSha256)) {
		throw new Error("embedding connection requires base URL, model, target hash and API key");
	}
	return { apiKey, baseUrl, model, targetSha256 };
}

export function createOpenAICompatibleEmbeddingClient(
	connection: EmbeddingConnection,
	fetchImpl: typeof fetch = fetch,
): EmbeddingClient {
	return {
		async embed(input) {
			const response = await fetchImpl(`${connection.baseUrl}/embeddings`, {
				body: JSON.stringify({
					dimensions: input.dimensions,
					input: input.texts,
					model: connection.model,
				}),
				headers: {
					authorization: `Bearer ${connection.apiKey}`,
					"content-type": "application/json",
				},
				method: "POST",
			});
			if (!response.ok) throw new Error(`embedding provider returned HTTP ${response.status}`);
			const payload = (await response.json()) as unknown;
			if (!isRecord(payload) || !Array.isArray(payload.data)) {
				throw new Error("embedding provider response is invalid");
			}
			const vectors = new Array<number[] | undefined>(input.texts.length);
			for (const [responseIndex, raw] of payload.data.entries()) {
				if (!isRecord(raw)) {
					throw new Error(`embedding provider response item ${responseIndex} is invalid`);
				}
				const itemIndex = raw.index;
				if (
					typeof itemIndex !== "number" ||
					!Number.isInteger(itemIndex) ||
					itemIndex < 0 ||
					itemIndex >= input.texts.length
				) {
					throw new Error(`embedding provider response item ${responseIndex} index is invalid`);
				}
				if (vectors[itemIndex]) {
					throw new Error(`embedding provider response index ${itemIndex} is duplicated`);
				}
				if (
					!Array.isArray(raw.embedding) ||
					raw.embedding.some((value) => typeof value !== "number")
				) {
					throw new Error(`embedding provider vector ${itemIndex} is invalid`);
				}
				vectors[itemIndex] = raw.embedding as number[];
			}
			return Array.from(vectors, (vector, index) => {
				if (!vector) {
					throw new Error(`embedding provider response is missing index ${index}`);
				}
				return vector;
			});
		},
	};
}

export async function embedTexts(
	client: EmbeddingClient,
	texts: readonly string[],
	onProgress?: (completedInputCount: number, totalInputCount: number) => void,
): Promise<number[][]> {
	const batches: Array<{ offset: number; texts: string[] }> = [];
	for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
		batches.push({
			offset,
			texts: texts.slice(offset, offset + EMBEDDING_BATCH_SIZE),
		});
	}
	const result = new Array<number[] | undefined>(texts.length);
	let completedInputCount = 0;
	for (
		let offset = 0;
		offset < batches.length;
		offset += EMBEDDING_REQUEST_CONCURRENCY
	) {
		const group = batches.slice(offset, offset + EMBEDDING_REQUEST_CONCURRENCY);
		await Promise.all(
			group.map(async (batch) => {
					const vectors = await client.embed({
						dimensions: EMBEDDING_SPACE.dimensions,
						texts: batch.texts,
					});
					if (vectors.length !== batch.texts.length) {
						throw new Error(
							`embedding result count ${vectors.length} does not match batch count ${batch.texts.length}`,
						);
					}
					for (const [index, vector] of vectors.entries()) {
						if (
							vector.length !== EMBEDDING_SPACE.dimensions ||
							vector.some((value) => !Number.isFinite(value))
						) {
							throw new Error(
								`embedding vector ${batch.offset + index} has invalid dimensions or values`,
							);
						}
						result[batch.offset + index] = vector;
					}
				}),
		);
		completedInputCount += group.reduce(
			(count, batch) => count + batch.texts.length,
			0,
		);
		onProgress?.(completedInputCount, texts.length);
	}
	return result.map((vector, index) => {
		if (!vector) throw new Error(`embedding result is missing input ${index}`);
		return vector;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
