import { describe, expect, it, vi } from "vitest";

import { createQdrantClient } from "../src/qdrant.ts";
import type { IndexPoint, QdrantIndexClient } from "../src/types.ts";

const point: IndexPoint = {
	id: "12345678-1234-5123-8123-123456789abc",
	payload: {
		chunk_id: "chunk_1",
		document_id: "doc_1",
		document_title: "考勤规定",
		retrieval_text_sha256: `sha256:${"c".repeat(64)}`,
		root_unit_ids: ["unit_1", "unit_2"],
		schema_version: "campus_docs_point.v3",
		section_ref: "/docs/regulations/student_rules/attendance/v/2026-current#attendance",
		section_title: "考勤",
		text: "学生应按时到课。",
		text_sha256: `sha256:${"b".repeat(64)}`,
		version_id: "version_2026_current",
		version_label: "2026 版",
		version_slug: "2026-current",
	},
	vector: {
		dense: [0.1, 0.2, 0.3],
		sparse: { indices: [10, 20], values: [0.5, 1.25] },
	},
};

describe("Campus docs Qdrant validation", () => {
	it("reads back payload plus dense and sparse vectors", async () => {
		const fetchMock = qdrantFetch(point);
		const client = createQdrantClient(
			{ QDRANT_API_KEY: "test", QDRANT_URL: "https://qdrant.example" },
			fetchMock,
		);

		await client.validate({
			collection: `campus_docs_${"a".repeat(64)}`,
			denseDistance: "Cosine",
			denseVectorName: "dense",
			dimensions: 3,
			expectedPointCount: 1,
			expectedPoints: [point],
			sparseModifier: "idf",
			sparseVectorName: "sparse",
		});

		const scrollCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/points/scroll"));
		expect(scrollCall).toBeDefined();
		expect(JSON.parse(String(scrollCall?.[1]?.body))).toEqual({
			limit: 256,
			with_payload: true,
			with_vector: ["dense", "sparse"],
		});
	});

	it("rejects a point whose payload differs", async () => {
		const stored = {
			...point,
			payload: { ...point.payload, text: "wrong text" },
		};
		const client = createQdrantClient(
			{ QDRANT_API_KEY: "test", QDRANT_URL: "https://qdrant.example" },
			qdrantFetch(stored),
		);

		await expect(
			client.validate({
				collection: `campus_docs_${"a".repeat(64)}`,
				denseDistance: "Cosine",
				denseVectorName: "dense",
				dimensions: 3,
				expectedPointCount: 1,
				expectedPoints: [point],
				sparseModifier: "idf",
				sparseVectorName: "sparse",
			}),
		).rejects.toThrow("Qdrant point payload does not match published chunk");
	});

	it("validates points outside the former first-middle-last sample", async () => {
		const expected = Array.from({ length: 5 }, (_value, index) => indexedPoint(index));
		const stored = expected.map((value) => ({
			...value,
			payload: { ...value.payload },
			vector: {
				dense: [...value.vector.dense],
				sparse: {
					indices: [...value.vector.sparse.indices],
					values: [...value.vector.sparse.values],
				},
			},
		}));
		const second = stored[1];
		if (!second) throw new Error("test point is missing");
		second.payload.text = "wrong text outside the former sample";
		const client = createQdrantClient(
			{ QDRANT_API_KEY: "test", QDRANT_URL: "https://qdrant.example" },
			qdrantValidationFetch({
				count: expected.length,
				pages: [{ nextOffset: null, points: stored }],
			}),
		);

		await expect(validatePoints(client, expected)).rejects.toThrow(
			"Qdrant point payload does not match published chunk",
		);
	});

	it("validates collection distance", async () => {
		const client = createQdrantClient(
			{ QDRANT_API_KEY: "test", QDRANT_URL: "https://qdrant.example" },
			qdrantValidationFetch({
				count: 1,
				distance: "Dot",
				pages: [{ nextOffset: null, points: [point] }],
			}),
		);

		await expect(validatePoints(client, [point])).rejects.toThrow(
			"Qdrant dense vector distance does not match the index definition",
		);
	});

	it("scrolls every validation page", async () => {
		const expected = [indexedPoint(0), indexedPoint(1)];
		const fetchMock = qdrantValidationFetch({
			count: expected.length,
			pages: [
				{ nextOffset: "page-2", points: [expected[0] as IndexPoint] },
				{ offset: "page-2", nextOffset: null, points: [expected[1] as IndexPoint] },
			],
		});
		const client = createQdrantClient(
			{ QDRANT_API_KEY: "test", QDRANT_URL: "https://qdrant.example" },
			fetchMock,
		);

		await validatePoints(client, expected);
		const scrollBodies = fetchMock.mock.calls
			.filter(([url]) => String(url).endsWith("/points/scroll"))
			.map(([, init]) => JSON.parse(String(init?.body)) as { offset?: string });
		expect(scrollBodies.map((body) => body.offset)).toEqual([undefined, "page-2"]);
	});

	it.each([
		{
			expected: [indexedPoint(0), indexedPoint(1)],
			message: "Qdrant validation scroll repeated point",
			name: "duplicate point",
			pages: [
				{ nextOffset: "page-2", points: [indexedPoint(0)] },
				{ offset: "page-2", nextOffset: null, points: [indexedPoint(0)] },
			],
		},
		{
			expected: [indexedPoint(0), indexedPoint(1)],
			message: "Qdrant target collection is missing expected point",
			name: "missing point",
			pages: [{ nextOffset: null, points: [indexedPoint(0)] }],
		},
		{
			expected: [indexedPoint(0)],
			message: "Qdrant collection contains unexpected point",
			name: "unexpected point",
			pages: [{ nextOffset: null, points: [indexedPoint(0), indexedPoint(1)] }],
		},
	])("rejects $name", async ({ expected, message, pages }) => {
		const client = createQdrantClient(
			{ QDRANT_API_KEY: "test", QDRANT_URL: "https://qdrant.example" },
			qdrantValidationFetch({ count: expected.length, pages }),
		);

		await expect(validatePoints(client, expected)).rejects.toThrow(message);
	});

});

function indexedPoint(index: number): IndexPoint {
	return {
		...point,
		id: `12345678-1234-5123-8123-${index.toString(16).padStart(12, "0")}`,
		payload: {
			...point.payload,
			chunk_id: `chunk_${index}`,
		},
		vector: {
			dense: [...point.vector.dense],
			sparse: {
				indices: [...point.vector.sparse.indices],
				values: [...point.vector.sparse.values],
			},
		},
	};
}

async function validatePoints(client: QdrantIndexClient, expectedPoints: IndexPoint[]): Promise<void> {
	await client.validate({
		collection: `campus_docs_${"a".repeat(64)}`,
		denseDistance: "Cosine",
		denseVectorName: "dense",
		dimensions: 3,
		expectedPointCount: expectedPoints.length,
		expectedPoints,
		sparseModifier: "idf",
		sparseVectorName: "sparse",
	});
}

function qdrantValidationFetch(input: {
	count: number;
	distance?: string;
	pages: Array<{ nextOffset: string | null; offset?: string; points: IndexPoint[] }>;
}): ReturnType<typeof vi.fn<typeof fetch>> {
	return vi.fn<typeof fetch>(async (request, init) => {
		const url = String(request);
		if (url.endsWith("/points/count")) {
			return jsonResponse({ result: { count: input.count } });
		}
		if (url.endsWith("/points/scroll") && init?.method === "POST") {
			const body = JSON.parse(String(init.body)) as { offset?: string };
			const page = input.pages.find((candidate) => candidate.offset === body.offset);
			if (!page) return jsonResponse({ error: "unexpected scroll offset" }, 400);
			return jsonResponse({
				result: {
					next_page_offset: page.nextOffset,
					points: page.points,
				},
			});
		}
		if (url.includes("/collections/")) {
			return jsonResponse({
				result: {
					config: {
						params: {
							sparse_vectors: { sparse: { modifier: "idf" } },
							vectors: { dense: { distance: input.distance ?? "Cosine", size: 3 } },
						},
					},
				},
			});
		}
		return jsonResponse({ error: "unexpected request" }, 404);
	});
}

function qdrantFetch(storedPoint: IndexPoint): ReturnType<typeof vi.fn<typeof fetch>> {
	return qdrantValidationFetch({
		count: 1,
		pages: [{ nextOffset: null, points: [storedPoint] }],
	});
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status,
	});
}
