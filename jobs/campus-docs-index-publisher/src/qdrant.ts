import { isDeepStrictEqual } from "node:util";

import type {
	IndexPoint,
	QdrantIndexClient,
} from "./types.ts";

const SCROLL_PAGE_SIZE = 256;

export interface QdrantEnv {
	QDRANT_API_KEY?: string;
	QDRANT_URL?: string;
}

export class QdrantCollectionContentMismatchError extends Error {
	override readonly name = "QdrantCollectionContentMismatchError";
}

export function createQdrantClient(env: QdrantEnv = process.env, fetchImpl: typeof fetch = fetch): QdrantIndexClient {
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
			const response = await fetchImpl(`${baseURL}/collections/${encodeURIComponent(collection)}`, {
				headers: { "api-key": apiKey },
			});
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
		async deleteCollection(collection) {
			const response = await fetchImpl(`${baseURL}/collections/${encodeURIComponent(collection)}`, {
				headers: { "api-key": apiKey },
				method: "DELETE",
			});
			if (!response.ok && response.status !== 404) throw new Error(`Qdrant delete returned HTTP ${response.status}`);
		},
		async upsert(input) {
			await request(`/collections/${encodeURIComponent(input.collection)}/points?wait=true`, {
				body: JSON.stringify({
					points: input.points.map((point) =>
						toQdrantPoint(point, input.denseVectorName, input.sparseVectorName),
					),
				}),
				method: "PUT",
			});
		},
		async validate(input) {
			if (input.expectedPoints.length !== input.expectedPointCount || input.expectedPointCount < 1) {
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
			const countPayload = await request(`/collections/${encodeURIComponent(input.collection)}/points/count`, {
				body: JSON.stringify({ exact: true }),
				method: "POST",
			});
			if (!isRecord(countPayload) || !isRecord(countPayload.result) || countPayload.result.count !== input.expectedPointCount) {
				mismatch("Qdrant point count does not match published chunks");
			}
			await validateStoredPoints(request, input);
		},
	};
}

function toQdrantPoint(point: IndexPoint, denseVectorName: string, sparseVectorName: string): Record<string, unknown> {
	return {
		id: point.id,
		payload: point.payload,
		vector: {
			[denseVectorName]: point.vector.dense,
			[sparseVectorName]: point.vector.sparse,
		},
	};
}

function assertCollectionConfiguration(
	value: unknown,
	denseDistance: string,
	dimensions: number,
	denseVectorName: string,
	sparseModifier: string,
	sparseVectorName: string,
): void {
	if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.config) || !isRecord(value.result.config.params)) {
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
	if (String(vectors[denseVectorName].distance).toLowerCase() !== denseDistance.toLowerCase()) {
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
		expectedPoints: IndexPoint[];
		sparseVectorName: string;
	},
): Promise<void> {
	const expected = new Map<string, IndexPoint>();
	for (const point of input.expectedPoints) {
		if (expected.has(point.id)) {
			mismatch(`Qdrant expected point identity is duplicated: ${point.id}`);
		}
		expected.set(point.id, point);
	}

	const seenPointIds = new Set<string>();
	const seenOffsets = new Set<string>();
	let offset: string | undefined;
	for (;;) {
		const page = await request(
			`/collections/${encodeURIComponent(input.collection)}/points/scroll`,
			{
				body: JSON.stringify({
					limit: SCROLL_PAGE_SIZE,
					...(offset === undefined ? {} : { offset }),
					with_payload: true,
					with_vector: [input.denseVectorName, input.sparseVectorName],
				}),
				method: "POST",
			},
		);
		if (!isRecord(page) || !isRecord(page.result) || !Array.isArray(page.result.points)) {
			mismatch("Qdrant validation scroll response is invalid");
		}
		for (const stored of page.result.points) {
			if (!isRecord(stored) || typeof stored.id !== "string" || !stored.id) {
				mismatch("Qdrant validation point identity is invalid");
			}
			if (seenPointIds.has(stored.id)) {
				mismatch(`Qdrant validation scroll repeated point: ${stored.id}`);
			}
			seenPointIds.add(stored.id);
			const point = expected.get(stored.id);
			if (!point) {
				mismatch(`Qdrant collection contains unexpected point: ${stored.id}`);
			}
			assertStoredPoint(
				stored,
				point,
				input.denseDistance,
				input.dimensions,
				input.denseVectorName,
				input.sparseVectorName,
			);
		}

		const nextOffset = page.result.next_page_offset;
		if (nextOffset === null || nextOffset === undefined) break;
		if (typeof nextOffset !== "string" || !nextOffset || seenOffsets.has(nextOffset)) {
			mismatch("Qdrant validation scroll offset is invalid");
		}
		seenOffsets.add(nextOffset);
		offset = nextOffset;
	}

	for (const pointId of expected.keys()) {
		if (!seenPointIds.has(pointId)) {
			mismatch(`Qdrant target collection is missing expected point: ${pointId}`);
		}
	}
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
		mismatch(`Qdrant point payload does not match published chunk: ${point.id}`);
	}
	if (!isRecord(actual.vector)) {
		mismatch(`Qdrant point vectors are missing: ${point.id}`);
	}
	assertApproximateVector(
		actual.vector[denseVectorName],
		expectedStoredDenseVector(point.vector.dense, denseDistance),
		dimensions,
		`dense vector ${point.id}`,
	);
	const sparse = actual.vector[sparseVectorName];
	if (!isRecord(sparse) || !isDeepStrictEqual(sparse.indices, point.vector.sparse.indices)) {
		mismatch(`Qdrant sparse vector indices do not match published chunk: ${point.id}`);
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
	// Qdrant stores dense vectors L2-normalized in Cosine collections.
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
	if (!normalized) throw new Error(`${name} is required for Campus docs publisher`);
	return normalized;
}
