import { isDeepStrictEqual } from "node:util";

import type {
	IndexPoint,
	QdrantIndexClient,
	QdrantPayloadIndexSchema,
} from "./types.ts";

const SCROLL_PAGE_SIZE = 256;

export interface QdrantEnv {
	QDRANT_API_KEY?: string;
	QDRANT_URL?: string;
}

export class QdrantCollectionContentMismatchError extends Error {
	override readonly name = "QdrantCollectionContentMismatchError";
}

export function createQdrantClient(
	env: QdrantEnv = process.env,
	fetchImpl: typeof fetch = fetch,
): QdrantIndexClient {
	const baseURL = requiredEnv(env.QDRANT_URL, "QDRANT_URL").replace(/\/$/u, "");
	const apiKey = requiredEnv(env.QDRANT_API_KEY, "QDRANT_API_KEY");
	const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
		const response = await fetchImpl(`${baseURL}${path}`, {
			...init,
			headers: {
				...(init.headers ?? {}),
				"api-key": apiKey,
				"content-type": "application/json",
			},
		});
		if (!response.ok) throw new Error(`Qdrant ${path} returned HTTP ${response.status}`);
		if (response.status === 204) return undefined;
		try {
			return await response.json();
		} catch (error) {
			throw new Error(`Qdrant ${path} returned invalid JSON`, { cause: error });
		}
	};
	return {
		async collectionExists(collection) {
			const response = await fetchImpl(
				`${baseURL}/collections/${encodeURIComponent(collection)}`,
				{ headers: { "api-key": apiKey } },
			);
			if (response.status === 404) return false;
			if (!response.ok) {
				throw new Error(`Qdrant collection lookup returned HTTP ${response.status}`);
			}
			return true;
		},
		async createCollection(input) {
			await request(`/collections/${encodeURIComponent(input.collection)}`, {
				body: JSON.stringify({
					sparse_vectors: {
						[input.sparseVectorName]: { modifier: "idf" },
					},
					vectors: {
						[input.denseVectorName]: {
							distance: input.denseDistance,
							size: input.denseDimensions,
						},
					},
				}),
				method: "PUT",
			});
		},
		async createPayloadIndex(input: {
			collection: string;
			fieldName: string;
			fieldSchema: QdrantPayloadIndexSchema;
		}) {
			const response = await request(
				`/collections/${encodeURIComponent(input.collection)}/index?wait=true`,
				{
					body: JSON.stringify({
						field_name: input.fieldName,
						field_schema: input.fieldSchema,
					}),
					method: "PUT",
				},
			);
			if (
				isRecord(response) &&
				isRecord(response.result) &&
				typeof response.result.status === "string" &&
				response.result.status !== "completed"
			) {
				throw new Error(
					`Qdrant payload index ${input.fieldName} did not complete: ${response.result.status}`,
				);
			}
		},
		async deleteCollection(collection) {
			const response = await fetchImpl(
				`${baseURL}/collections/${encodeURIComponent(collection)}`,
				{ headers: { "api-key": apiKey }, method: "DELETE" },
			);
			if (!response.ok && response.status !== 404) {
				throw new Error(`Qdrant delete returned HTTP ${response.status}`);
			}
		},
		async upsert(input) {
			const response = await request(
				`/collections/${encodeURIComponent(input.collection)}/points?wait=true`,
				{
					body: JSON.stringify({
						points: input.points.map((point) =>
							toQdrantPoint(point, input.denseVectorName, input.sparseVectorName),
						),
					}),
					method: "PUT",
				},
			);
			if (!isRecord(response) || !isRecord(response.result) || typeof response.result.status !== "string") {
				throw new Error("Qdrant upsert returned an invalid operation result");
			}
			if (response.result.status !== "completed") {
				throw new Error(`Qdrant upsert did not complete: ${response.result.status}`);
			}
		},
		async validate(input) {
			if (
				(Array.isArray(input.expectedPoints) && input.expectedPoints.length !== input.expectedPointCount) ||
				input.expectedPointCount < 1
			) {
				throw new Error("Qdrant validation points do not match the expected point count");
			}
			const info = await request(`/collections/${encodeURIComponent(input.collection)}`);
			assertCollectionConfiguration(
				info,
				input.denseDistance,
				input.dimensions,
				input.denseVectorName,
				input.sparseModifier,
				input.sparseVectorName,
			);
			const countPayload = await request(
				`/collections/${encodeURIComponent(input.collection)}/points/count`,
				{ body: JSON.stringify({ exact: true }), method: "POST" },
			);
			if (
				!isRecord(countPayload) ||
				!isRecord(countPayload.result) ||
				countPayload.result.count !== input.expectedPointCount
			) {
				mismatch("Qdrant point count does not match the candidate");
			}
			await validateStoredPoints(request, input);
		},
	};
}

function toQdrantPoint(
	point: IndexPoint,
	denseVectorName: string,
	sparseVectorName: string,
): Record<string, unknown> {
	return {
		id: point.id,
		payload: point.payload,
		vector: {
			[denseVectorName]: point.vector.dense,
			[sparseVectorName]: point.vector.sparse,
		},
	};
}

export function assertCollectionConfiguration(
	value: unknown,
	denseDistance: string,
	dimensions: number,
	denseVectorName: string,
	sparseModifier: string,
	sparseVectorName: string,
): void {
	if (
		!isRecord(value) ||
		!isRecord(value.result) ||
		!isRecord(value.result.config) ||
		!isRecord(value.result.config.params)
	) {
		mismatch("Qdrant collection info is invalid");
	}
	const params = value.result.config.params;
	const vectors = params.vectors;
	if (
		!isRecord(vectors) ||
		!isRecord(vectors[denseVectorName]) ||
		vectors[denseVectorName].size !== dimensions
	) {
		mismatch("Qdrant dense vector dimensions do not match the index definition");
	}
	if (
		String(vectors[denseVectorName].distance).toLowerCase() !==
		denseDistance.toLowerCase()
	) {
		mismatch("Qdrant dense vector distance does not match the index definition");
	}
	const sparseVectors = params.sparse_vectors;
	if (
		!isRecord(sparseVectors) ||
		!isRecord(sparseVectors[sparseVectorName]) ||
		String(sparseVectors[sparseVectorName].modifier).toLowerCase() !==
			sparseModifier.toLowerCase()
	) {
		mismatch("Qdrant sparse vector configuration does not match the index definition");
	}
}

async function validateStoredPoints(
	request: (path: string, init?: RequestInit) => Promise<unknown>,
	input: {
		collection: string;
		denseDistance: string;
		denseVectorName: string;
		dimensions: number;
		expectedPointCount: number;
		expectedPoints: Iterable<IndexPoint> | AsyncIterable<IndexPoint>;
		sparseVectorName: string;
	},
): Promise<void> {
	const seen = new Set<string>();
	let batch: IndexPoint[] = [];
	const check = async () => {
		const response = await request(`/collections/${encodeURIComponent(input.collection)}/points`, {
			method: "POST",
			body: JSON.stringify({ ids: batch.map((point) => point.id), with_payload: true,
				with_vector: [input.denseVectorName, input.sparseVectorName] }),
		});
		if (!isRecord(response) || !Array.isArray(response.result)) mismatch("Qdrant point response is invalid");
		const actual = new Map(response.result.map((point: unknown) => {
			if (!isRecord(point) || typeof point.id !== "string") mismatch("Qdrant point identity is invalid");
			return [point.id, point] as const;
		}));
		for (const point of batch) {
			const stored = actual.get(point.id);
			if (!stored) mismatch(`Qdrant target collection is missing expected point: ${point.id}`);
			assertStoredPoint(stored, point, input.denseDistance, input.dimensions, input.denseVectorName, input.sparseVectorName);
		}
		batch = [];
	};
	for await (const point of input.expectedPoints) {
		if (seen.has(point.id)) mismatch(`candidate point identity is duplicated: ${point.id}`);
		seen.add(point.id);
		batch.push(point);
		if (batch.length === SCROLL_PAGE_SIZE) await check();
	}
	if (batch.length) await check();
	if (seen.size !== input.expectedPointCount) mismatch("Qdrant validation points do not match the expected point count");
}

function assertStoredPoint(
	actual: Record<string, unknown>,
	point: IndexPoint,
	denseDistance: string,
	dimensions: number,
	denseVectorName: string,
	sparseVectorName: string,
): void {
	if (!isDeepStrictEqual(actual.payload, point.payload)) {
		mismatch(`Qdrant point payload does not match the candidate: ${point.id}`);
	}
	if (!isRecord(actual.vector)) mismatch(`Qdrant point vectors are missing: ${point.id}`);
	assertApproximateVector(
		actual.vector[denseVectorName],
		expectedStoredDenseVector(point.vector.dense, denseDistance),
		dimensions,
		`dense vector ${point.id}`,
	);
	const sparse = actual.vector[sparseVectorName];
	if (!isRecord(sparse) || !isDeepStrictEqual(sparse.indices, point.vector.sparse.indices)) {
		mismatch(`Qdrant sparse vector indices do not match the candidate: ${point.id}`);
	}
	assertApproximateVector(
		sparse.values,
		point.vector.sparse.values,
		point.vector.sparse.values.length,
		`sparse vector ${point.id}`,
	);
}

function expectedStoredDenseVector(vector: readonly number[], distance: string): readonly number[] {
	if (distance.toLowerCase() !== "cosine") return vector;
	const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	if (norm === 0) return vector;
	return vector.map((value) => value / norm);
}

function assertApproximateVector(
	actual: unknown,
	expected: readonly number[],
	dimensions: number,
	label: string,
): void {
	if (!Array.isArray(actual) || actual.length !== dimensions || expected.length !== dimensions) {
		mismatch(`Qdrant ${label} dimensions do not match`);
	}
	for (const [index, expectedValue] of expected.entries()) {
		const actualValue = actual[index];
		if (
			typeof actualValue !== "number" ||
			!Number.isFinite(actualValue) ||
			Math.abs(actualValue - expectedValue) > 1e-5 * Math.max(1, Math.abs(expectedValue))
		) {
			mismatch(`Qdrant ${label} values do not match`);
		}
	}
}

function mismatch(message: string): never {
	throw new QdrantCollectionContentMismatchError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for Campus RAG publisher`);
	return normalized;
}
