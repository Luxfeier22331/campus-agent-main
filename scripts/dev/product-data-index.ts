import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { COLLECTION_DEFINITION } from "../../jobs/campus-rag-index-publisher/src/definitions.ts";
import type { StreamingIndexCandidate } from "../../jobs/campus-rag-index-publisher/src/publisher.ts";
import { assertCollectionConfiguration } from "../../jobs/campus-rag-index-publisher/src/qdrant.ts";
import type { UnifiedPoint } from "../../jobs/campus-rag-index-publisher/src/types.ts";

export async function downloadProductIndex(input: {
	collection: string;
	path: string;
	request(path: string, body?: unknown): Promise<unknown>;
	validatePoint(point: UnifiedPoint): void;
}): Promise<StreamingIndexCandidate> {
	if (!/^campus_docs_[a-f0-9]{64}$/u.test(input.collection)) {
		throw new Error("Invalid source collection identity");
	}
	const base = `/collections/${input.collection}`;
	assertCollectionConfiguration(
		await input.request(base),
		"Cosine",
		2560,
		COLLECTION_DEFINITION.dense.vectorName,
		"idf",
		COLLECTION_DEFINITION.sparse.vectorName,
	);
	const count = (await input.request(`${base}/points/count`, { exact: true })) as {
		result: { count: number };
	};
	const expected = count.result.count;
	if (!Number.isSafeInteger(expected) || expected < 1) {
		throw new Error("Source index is empty or invalid");
	}
	const file = await open(input.path, "wx", 0o600);
	let offset: string | undefined;
	let pointCount = 0;
	const ids = new Set<string>();
	const kinds = new Set<unknown>();
	try {
		for (;;) {
			const page = (await input.request(`${base}/points/scroll`, {
				limit: 128,
				offset,
				with_payload: true,
				with_vector: true,
			})) as { result: { points: UnifiedPoint[]; next_page_offset: string | null } };
			for (const point of page.result.points) {
				if (typeof point.id !== "string" || ids.has(point.id)) {
					throw new Error("Source index repeated or invalid point identity");
				}
				ids.add(point.id);
				if (
					!Array.isArray(point.vector?.dense) ||
					point.vector.dense.length !== 2560 ||
					point.vector.dense.some((value) => !Number.isFinite(value))
				) {
					throw new Error(`Invalid dense vector: ${point.id}`);
				}
				if (
					!(
						Array.isArray(point.vector.sparse?.indices) && Array.isArray(point.vector.sparse.values)
					) ||
					point.vector.sparse.indices.length !== point.vector.sparse.values.length ||
					point.vector.sparse.indices.some((value) => !Number.isSafeInteger(value) || value < 0) ||
					point.vector.sparse.values.some((value) => !Number.isFinite(value))
				) {
					throw new Error(`Invalid sparse vector: ${point.id}`);
				}
				input.validatePoint(point);
				kinds.add(point.payload.source_kind);
				await file.write(`${JSON.stringify(point)}\n`);
				pointCount += 1;
			}
			if (page.result.next_page_offset === null || page.result.next_page_offset === undefined) {
				break;
			}
			if (page.result.points.length === 0 || page.result.next_page_offset === offset) {
				throw new Error("Source index scroll made no progress");
			}
			offset = page.result.next_page_offset;
		}
		if (pointCount !== expected || !kinds.has("notice") || !kinds.has("document")) {
			throw new Error("Source index must be a complete mixed Docs/Notice collection");
		}
	} finally {
		await file.close();
	}
	return { collection: input.collection, pointCount, points: () => readProductPoints(input.path) };
}

export async function* readProductPoints(path: string): AsyncGenerator<UnifiedPoint> {
	const stream = createReadStream(path);
	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (line.trim()) {
				yield JSON.parse(line) as UnifiedPoint;
			}
		}
	} finally {
		lines.close();
		stream.destroy();
	}
}
