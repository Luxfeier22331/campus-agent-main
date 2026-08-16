import type { EmbeddingClient, EmbeddingProviderSnapshot } from "./types.ts";

export const EMBEDDING_PROVIDER_SNAPSHOT_URL =
	"http://execution-control-provider-snapshot:8002/internal/provider-snapshots/embedding";

export async function fetchEmbeddingProviderSnapshot(
	fetchImpl: typeof fetch = fetch,
	url = EMBEDDING_PROVIDER_SNAPSHOT_URL,
): Promise<EmbeddingProviderSnapshot> {
	const response = await fetchImpl(url, {
		headers: { accept: "application/json" },
		method: "GET",
		redirect: "error",
	});
	if (!response.ok) {
		throw new Error(`embedding provider snapshot returned HTTP ${response.status}`);
	}
	const payload = (await response.json()) as unknown;
	if (
		!isRecord(payload) ||
		payload.schema_version !== "embedding_provider_snapshot.v1" ||
		(payload.provider !== "openai" && payload.provider !== "openai-compatible") ||
		!nonEmptyString(payload.base_url) ||
		!nonEmptyString(payload.model) ||
		!nonEmptyString(payload.api_key)
	) {
		throw new Error("embedding provider snapshot is invalid");
	}
	return {
		apiKey: payload.api_key,
		baseUrl: payload.base_url.replace(/\/$/u, ""),
		model: payload.model,
		provider: payload.provider,
		schemaVersion: "embedding_provider_snapshot.v1",
	};
}

export function createOpenAICompatibleEmbeddingClient(
	snapshot: EmbeddingProviderSnapshot,
	fetchImpl: typeof fetch = fetch,
): EmbeddingClient {
	return {
		async embed(input) {
			const response = await fetchImpl(`${snapshot.baseUrl}/embeddings`, {
				body: JSON.stringify({
					dimensions: input.dimensions,
					input: input.texts,
					model: snapshot.model,
				}),
				headers: {
					authorization: `Bearer ${snapshot.apiKey}`,
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

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
