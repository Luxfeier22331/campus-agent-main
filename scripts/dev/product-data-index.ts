import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { RetryableProductTransferError } from "./product-data-errors.ts";
import { COLLECTION_DEFINITION } from "../../jobs/campus-rag-index-publisher/src/definitions.ts";
import type { StreamingIndexCandidate } from "../../jobs/campus-rag-index-publisher/src/publisher.ts";
import { assertCollectionConfiguration } from "../../jobs/campus-rag-index-publisher/src/qdrant.ts";
import type { UnifiedPoint } from "../../jobs/campus-rag-index-publisher/src/types.ts";

const QDRANT_PAGE_SIZE = 64;
const QDRANT_MAX_PAGE_RETRIES = 2;

export async function downloadProductIndex(input: {
	collection: string;
	path: string;
	request(path: string, body?: unknown): Promise<unknown>;
	validatePoint(point: UnifiedPoint): void;
	signal?: AbortSignal;
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
			input.signal?.throwIfAborted();
			const page = await readScrollPage(
				input.request,
				`${base}/points/scroll`,
				{
					limit: QDRANT_PAGE_SIZE,
					offset,
					with_payload: true,
					with_vector: true,
				},
				offset,
				input.signal,
			);
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
				await file.writeFile(`${JSON.stringify(point)}\n`);
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

async function readScrollPage(
	request: (path: string, body?: unknown) => Promise<unknown>,
	path: string,
	body: unknown,
	offset: string | undefined,
	signal?: AbortSignal,
): Promise<{ result: { points: UnifiedPoint[]; next_page_offset: string | null } }> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= QDRANT_MAX_PAGE_RETRIES; attempt += 1) {
		signal?.throwIfAborted();
		try {
			const page = (await request(path, body)) as {
				result?: { points?: UnifiedPoint[]; next_page_offset?: string | null };
			};
			if (
				!page.result ||
				!Array.isArray(page.result.points) ||
				!(page.result.next_page_offset === null || typeof page.result.next_page_offset === "string")
			) {
				throw new Error("Qdrant scroll response has an invalid result");
			}
			return {
				result: {
					next_page_offset: page.result.next_page_offset ?? null,
					points: page.result.points,
				},
			};
		} catch (error) {
			lastError = error;
			if (attempt >= QDRANT_MAX_PAGE_RETRIES || !(error instanceof RetryableProductTransferError)) {
				throw new Error(
					`Qdrant scroll failed (path=${path}, offset=${offset ?? "<start>"}, attempt=${attempt + 1}): ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			await delay(attempt === 0 ? 250 : 1000, undefined, { signal });
		}
	}
	throw lastError;
}

export async function* readProductPoints(path: string): AsyncGenerator<UnifiedPoint> {
	// Decode UTF-8 across chunks, but split records only at LF. Unicode line
	// separators such as U+2028/U+2029 are valid characters inside JSON strings.
	const stream = createReadStream(path, { encoding: "utf8" });
	let pending = "";
	try {
		for await (const chunk of stream) {
			pending += chunk;
			let start = 0;
			let end: number;
			while ((end = pending.indexOf("\n", start)) !== -1) {
				const line = pending.slice(start, end);
				start = end + 1;
				if (line.trim()) yield JSON.parse(line) as UnifiedPoint;
			}
			pending = pending.slice(start);
		}
		if (pending.trim()) yield JSON.parse(pending) as UnifiedPoint;
	} finally {
		stream.destroy();
	}
}
