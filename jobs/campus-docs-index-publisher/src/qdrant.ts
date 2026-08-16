import { isDeepStrictEqual } from "node:util";

import type {
	IndexPoint,
	QdrantIndexClient,
	StoredDenseVector,
} from "./types.ts";

const SCROLL_PAGE_SIZE = 256;

export interface QdrantEnv {
	CAMPUS_DOCS_QDRANT_API_KEY?: string;
	CAMPUS_DOCS_QDRANT_URL?: string;
}

export class QdrantCollectionContentMismatchError extends Error {
	override readonly name = "QdrantCollectionContentMismatchError";
}

export function createQdrantClient(env: QdrantEnv = process.env, fetchImpl: typeof fetch = fetch): QdrantIndexClient {
	const baseURL = requiredEnv(env.CAMPUS_DOCS_QDRANT_URL, "CAMPUS_DOCS_QDRANT_URL").replace(/\/$/u, "");
	const apiKey = requiredEnv(env.CAMPUS_DOCS_QDRANT_API_KEY, "CAMPUS_DOCS_QDRANT_API_KEY");
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
		async readDenseVectors(input) {
			const result: StoredDenseVector[] = [];
			const seenPointIds = new Set<string>();
			const seenOffsets = new Set<string>();
			let offset: string | undefined;
			for (;;) {
				const page = await request(`/collections/${encodeURIComponent(input.collection)}/points/scroll`, {
					body: JSON.stringify({
						limit: SCROLL_PAGE_SIZE,
						...(offset === undefined ? {} : { offset }),
						with_payload: ["schema_version", "retrieval_text_sha256"],
						with_vector: [input.denseVectorName],
					}),
					method: "POST",
				});
				if (!isRecord(page) || !isRecord(page.result) || !Array.isArray(page.result.points)) {
					mismatch("Qdrant dense vector scroll response is invalid");
				}
				for (const value of page.result.points) {
					const vector = parseStoredDenseVector(value, input.denseVectorName, input.dimensions);
					if (seenPointIds.has(vector.pointId)) {
						mismatch(`Qdrant dense vector scroll repeated point: ${vector.pointId}`);
					}
					seenPointIds.add(vector.pointId);
					result.push(vector);
				}
				const nextOffset = page.result.next_page_offset;
				if (nextOffset === null || nextOffset === undefined) break;
				if (typeof nextOffset !== "string" || !nextOffset || seenOffsets.has(nextOffset)) {
					mismatch("Qdrant dense vector scroll offset is invalid");
				}
				seenOffsets.add(nextOffset);
				offset = nextOffset;
			}
			return result.sort((left, right) => left.pointId.localeCompare(right.pointId));
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

function parseStoredDenseVector(value: unknown, vectorName: string, dimensions: number): StoredDenseVector {
	if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
		mismatch("Qdrant dense vector point identity is invalid");
	}
	if (!isRecord(value.payload)) {
		mismatch(`Qdrant dense vector payload is missing: ${value.id}`);
	}
	const schemaVersion = value.payload.schema_version;
	const retrievalTextSha256 = value.payload.retrieval_text_sha256;
	if (typeof schemaVersion !== "string" || !/^campus_docs_point\.v[1-9][0-9]*$/u.test(schemaVersion)) {
		mismatch(`Qdrant dense vector point schema is invalid: ${value.id}`);
	}
	if (
		typeof retrievalTextSha256 !== "string" ||
		!/^sha256:[a-f0-9]{64}$/u.test(retrievalTextSha256)
	) {
		mismatch(`Qdrant dense vector retrieval text digest is invalid: ${value.id}`);
	}
	if (!isRecord(value.vector)) {
		mismatch(`Qdrant dense vector is missing: ${value.id}`);
	}
	const dense = value.vector[vectorName];
	assertFiniteVector(dense, dimensions, `dense vector ${value.id}`);
	return {
		dense: dense as number[],
		pointId: value.id,
		retrievalTextSha256: retrievalTextSha256 as `sha256:${string}`,
		schemaVersion,
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
		point.vector.dense,
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

function assertFiniteVector(actual: unknown, dimensions: number, label: string): asserts actual is number[] {
	if (
		!Array.isArray(actual) ||
		actual.length !== dimensions ||
		actual.some((value) => typeof value !== "number" || !Number.isFinite(value))
	) {
		mismatch(`Qdrant ${label} dimensions or values do not match`);
	}
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
