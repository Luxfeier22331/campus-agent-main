import type { EmbeddingClient } from "./types.ts";

export interface EmbeddingEnv {
	CAMPUS_DOCS_EMBEDDING_API_KEY?: string;
	CAMPUS_DOCS_EMBEDDING_BASE_URL?: string;
	CAMPUS_DOCS_EMBEDDING_SPACE_ID?: string;
}

export function createOpenAICompatibleEmbeddingClient(
	env: EmbeddingEnv = process.env,
	fetchImpl: typeof fetch = fetch,
): EmbeddingClient {
	const baseURL = requiredEnv(env.CAMPUS_DOCS_EMBEDDING_BASE_URL, "CAMPUS_DOCS_EMBEDDING_BASE_URL").replace(/\/$/u, "");
	const apiKey = requiredEnv(env.CAMPUS_DOCS_EMBEDDING_API_KEY, "CAMPUS_DOCS_EMBEDDING_API_KEY");
	const spaceId = requiredEnv(env.CAMPUS_DOCS_EMBEDDING_SPACE_ID, "CAMPUS_DOCS_EMBEDDING_SPACE_ID");
	return {
		spaceId,
		async embed(input) {
			const response = await fetchImpl(`${baseURL}/embeddings`, {
				body: JSON.stringify({
					dimensions: input.dimensions,
					input: input.texts,
					model: input.model,
				}),
				headers: {
					authorization: `Bearer ${apiKey}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for Campus docs publisher`);
	return normalized;
}
