import {
	CANONICAL_EMBEDDING_MODEL,
	createEmbeddingConnection,
	type EmbeddingConnection,
} from "@campus-agent/embedding-runtime";

export const EMBEDDING_MODEL_CONFIG_URL = "http://model-config:8000";

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}
