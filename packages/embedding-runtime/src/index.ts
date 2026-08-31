import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const CANONICAL_EMBEDDING_MODEL = "Qwen3-Embedding-4B" as const;

export const EMBEDDING_SPACE = {
	dimensions: 2560,
	spaceId: "qwen3-embedding-4b@2560-v1",
} as const;

const EMBEDDING_TARGET = {
	apiProtocol: "openai.embeddings",
	name: "campus_docs_embedding",
	provider: "openai-compatible",
} as const;

export const EMBEDDING_BATCH_SIZE = 8;
export const EMBEDDING_REQUEST_CONCURRENCY = 8;

export interface EmbeddingClient {
	embed(input: { texts: string[]; dimensions: number }): Promise<number[][]>;
}

export interface EmbeddingConnection {
	apiKey: string;
	baseUrl: string;
	model: typeof CANONICAL_EMBEDDING_MODEL;
	targetSha256: string;
}

export function normalizeEmbeddingBaseUrl(raw: string): string {
	const value = raw.trim();
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("embedding base URL must be an absolute credential-free HTTP(S) URL");
	}
	if (!(value && parsed.host && parsed.hostname) || parsed.username || parsed.password) {
		throw new Error("embedding base URL must be an absolute credential-free HTTP(S) URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("embedding base URL must use http or https");
	}
	if (parsed.search || parsed.hash) {
		throw new Error("embedding base URL must not contain query or fragment");
	}
	if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
		throw new Error("embedding base URL must use https outside loopback");
	}
	return parsed.toString().replace(/\/+$/u, "");
}

export function computeEmbeddingTargetSha256(baseUrl: string): string {
	const target = {
		name: EMBEDDING_TARGET.name,
		provider: EMBEDDING_TARGET.provider,
		api_protocol: EMBEDDING_TARGET.apiProtocol,
		base_url: normalizeEmbeddingBaseUrl(baseUrl),
		model: CANONICAL_EMBEDDING_MODEL,
	};
	return createHash("sha256").update(JSON.stringify(target), "utf8").digest("hex");
}

export function createLocalEmbeddingConnection(input: {
	apiKey: string;
	baseUrl: string;
}): EmbeddingConnection {
	const apiKey = input.apiKey.trim();
	const baseUrl = normalizeEmbeddingBaseUrl(input.baseUrl);
	if (!apiKey) {
		throw new Error("EMBEDDING_API_KEY is required");
	}
	return {
		apiKey,
		baseUrl,
		model: CANONICAL_EMBEDDING_MODEL,
		targetSha256: computeEmbeddingTargetSha256(baseUrl),
	};
}

export function createEmbeddingConnection(input: {
	apiKey: string;
	baseUrl: string;
	model: string;
	targetSha256: string;
}): EmbeddingConnection {
	const connection = createLocalEmbeddingConnection({
		apiKey: input.apiKey,
		baseUrl: input.baseUrl,
	});
	if (input.model.trim() !== CANONICAL_EMBEDDING_MODEL) {
		throw new Error("embedding model is fixed by the Campus Docs contract");
	}
	if (input.targetSha256 !== connection.targetSha256) {
		throw new Error("embedding target hash does not match the embedding connection");
	}
	return connection;
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
			if (!response.ok) {
				throw new Error(`embedding provider returned HTTP ${response.status}`);
			}
			const payload = (await response.json()) as unknown;
			if (!(isRecord(payload) && Array.isArray(payload.data))) {
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
	for (let offset = 0; offset < batches.length; offset += EMBEDDING_REQUEST_CONCURRENCY) {
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
		completedInputCount += group.reduce((count, batch) => count + batch.texts.length, 0);
		onProgress?.(completedInputCount, texts.length);
	}
	return result.map((vector, index) => {
		if (!vector) {
			throw new Error(`embedding result is missing input ${index}`);
		}
		return vector;
	});
}

function isLoopback(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
	if (host === "localhost" || host === "::1") {
		return true;
	}
	return isIP(host) === 4 && host.startsWith("127.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
