import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { RetryableProductTransferError } from "./product-data-errors.ts";
import { downloadProductIndex, readProductPoints } from "./product-data-index.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";

test("NDJSON preserves Unicode separators and UTF-8 across stream chunks", async () => {
	const directory = await mkdtemp(join(tmpdir(), "index-unicode-"));
	try {
		const path = join(directory, "points.ndjson");
		const seed = await readProductSeedIndex(resolve(import.meta.dirname, "../../.."));
		const point = seed.points[0];
		assert(point);
		const prefix = '{"payload":{"text":"';
		// Put the first byte of a multibyte character at the end of a 64 KiB chunk.
		const text = `${"a".repeat(65535 - Buffer.byteLength(prefix))}中\u2028文\u2029字\n末尾`;
		const first = { payload: { text }, id: point.id, vector: point.vector };
		const expected = [first, point, first];
		await writeFile(
			path,
			`${JSON.stringify(first)}\r\n\n${JSON.stringify(point)}\n${JSON.stringify(first)}`,
		);
		const actual: typeof seed.points = [];
		for await (const value of readProductPoints(path)) {
			actual.push(value);
		}
		assert.deepEqual(actual, expected);
		await writeFile(path, '{"payload":{"text":"truncated');
		await assert.rejects(async () => {
			for await (const _point of readProductPoints(path)) {
				/* consume */
			}
		}, SyntaxError);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("scroll retries the failed page only and writes complete NDJSON", async () => {
	const directory = await mkdtemp(join(tmpdir(), "index-transfer-"));
	try {
		const seed = await readProductSeedIndex(resolve(import.meta.dirname, "../../.."));
		const offsets: unknown[] = [];
		let failed = false;
		const candidate = await downloadProductIndex({
			collection: seed.collection,
			path: join(directory, "points"),
			validatePoint() {
				// The source points are validated by the production path before this test.
			},
			async request(path, body) {
				if (path.endsWith("/count")) {
					return { result: { count: seed.points.length } };
				}
				if (!path.endsWith("/scroll")) {
					return {
						result: {
							config: {
								params: {
									vectors: { dense: { size: 2560, distance: "Cosine" } },
									sparse_vectors: { sparse: { modifier: "idf" } },
								},
							},
						},
					};
				}
				const page = body as { offset?: string; limit: number };
				assert.equal(page.limit, 64);
				offsets.push(page.offset);
				if (page.offset && !failed) {
					failed = true;
					throw new RetryableProductTransferError("connection reset");
				}
				return {
					result: {
						points: page.offset ? seed.points.slice(1) : seed.points.slice(0, 1),
						next_page_offset: page.offset ? null : "next",
					},
				};
			},
		});
		const points: typeof seed.points = [];
		for await (const point of candidate.points()) {
			points.push(point);
		}
		assert.deepEqual(points, seed.points);
		assert.deepEqual(offsets, [undefined, "next", "next"]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const interruption of ["between pages", "during retry"] as const) {
	test(`aborting ${interruption} stops scroll and releases the NDJSON file`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "index-abort-"));
		const path = join(directory, "points.ndjson");
		const controller = new AbortController();
		let pages = 0;
		try {
			const seed = await readProductSeedIndex(resolve(import.meta.dirname, "../../.."));
			await assert.rejects(
				downloadProductIndex({
					collection: seed.collection,
					path,
					signal: controller.signal,
					async request(url) {
						if (url.endsWith("/count")) {
							return { result: { count: seed.points.length } };
						}
						if (!url.endsWith("/scroll")) {
							return {
								result: {
									config: {
										params: {
											vectors: { dense: { size: 2560, distance: "Cosine" } },
											sparse_vectors: { sparse: { modifier: "idf" } },
										},
									},
								},
							};
						}
						pages += 1;
						controller.abort();
						if (interruption === "during retry") {
							throw new RetryableProductTransferError("connection reset");
						}
						return { result: { points: seed.points.slice(0, 1), next_page_offset: "next" } };
					},
				}),
				{ name: "AbortError" },
			);
			assert.equal(pages, 1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}
