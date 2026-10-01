import { describe, expect, it, vi } from "vitest";

import { materializeCollection } from "../src/publisher.ts";
import { createQdrantClient } from "../src/qdrant.ts";
import type { IndexPoint } from "../src/types.ts";

const point: IndexPoint = {
	id: "12345678-1234-5123-8123-123456789abc",
	payload: { source_kind: "document" },
	vector: { dense: [1, 0], sparse: { indices: [1], values: [1] } },
};
const env = { QDRANT_API_KEY: "test", QDRANT_URL: "http://qdrant.local" };
const input = {
	collection: "candidate",
	denseVectorName: "dense",
	points: [point],
	sparseVectorName: "sparse",
};

describe("Campus RAG Qdrant write completion", () => {
	it("accepts a completed write and requests synchronous completion", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({ result: { operation_id: 15, status: "completed" }, status: "ok" }),
		);
		await expect(createQdrantClient(env, fetchMock).upsert(input)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledWith(
			"http://qdrant.local/collections/candidate/points?wait=true",
			expect.objectContaining({ method: "PUT" }),
		);
	});

	it.each(["wait_timeout", "acknowledged"])(
		"stops materialization before validation when HTTP 200 reports %s",
		async (status) => {
			const requests: string[] = [];
			const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
				const path = new URL(String(url)).pathname;
				const method = init?.method ?? "GET";
				requests.push(`${method} ${path}`);
				if (method === "GET") return new Response(null, { status: 404 });
				if (path.endsWith("/points")) {
					return Response.json({ result: { operation_id: 15, status }, status: "ok" });
				}
				return Response.json({ result: true, status: "ok" });
			});
			const client = createQdrantClient(env, fetchMock);
			const validate = vi.spyOn(client, "validate");

			await expect(materializeCollection(client, { collection: "candidate", points: [point] }))
				.rejects.toThrow(`Qdrant upsert did not complete: ${status}`);

			expect(validate).not.toHaveBeenCalled();
			expect(requests.filter((request) => request.startsWith("GET"))).toEqual([
				"GET /collections/candidate",
			]);
			expect(requests.at(-1)).toBe("DELETE /collections/candidate");
		},
	);

	it("does not accept a response without an operation result", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "ok" }));
		await expect(createQdrantClient(env, fetchMock).upsert(input))
			.rejects.toThrow("Qdrant upsert returned an invalid operation result");
	});
});
