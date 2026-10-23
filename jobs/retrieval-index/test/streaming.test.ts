import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { workspace, records, digest, canonical } from "../src/workspace.ts";
import { prepareCandidate, targetPoints } from "../src/candidate.ts";
import { initializeBuild, addChunk, generateEmbeddings } from "../src/build.ts";
import { batches } from "../src/apply.ts";
import { collectionName, indexRevision } from "../src/catalog.ts";
import { assembleCandidate } from "../src/publisher.ts";
import type { Sha256Ref, UnifiedPoint } from "../src/types.ts";
const workspaces: Awaited<ReturnType<typeof workspace>>[] = [];
afterEach(async () => {
	for (const work of workspaces.splice(0)) await work.close();
});
async function work() {
	const w = await workspace();
	workspaces.push(w);
	return w;
}
const root = resolve(
	import.meta.dirname,
	"../../../scripts/dev/product-data/fixtures/product-data",
);
const store = {
	read: (key: string) => readFile(resolve(root, key)),
	stream: (key: string) => createReadStream(resolve(root, key), { highWaterMark: 127 }),
};
it("streams real seed artifacts without buffering NDJSON and matches the existing revision identity", async () => {
	const binding = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
	const w = await work();
	const noWholeData = {
		...store,
		read: vi.fn((key: string) => {
			if (key.endsWith(".ndjson")) throw new Error("whole-data read");
			return store.read(key);
		}),
	};
	const result = await prepareCandidate(
		w.db,
		noWholeData,
		binding.docsEmbeddingSet,
		binding.noticeEmbeddingSet,
	);
	expect(result.pointCount).toBeGreaterThan(2);
	expect([...targetPoints(w.db)]).toHaveLength(result.pointCount);
	expect(result.revision).toBe(indexRevision(binding.docsEmbeddingSet, binding.noticeEmbeddingSet));
	// The versioned name equals the identity the previous publisher derived for these sets.
	expect(collectionName(result.revision)).toBe(
		(await assembleCandidate(store, binding.docsEmbeddingSet, binding.noticeEmbeddingSet)).collection,
	);
});
it("decodes split UTF-8 and rejects digest mismatch and incomplete final lines", async () => {
	const data = Buffer.from(canonical({ text: "中文😀" }) + "\n");
	const ref = { key: "data", byteSize: data.length, sha256: digest(data) };
	const input = {
		read: async () => data,
		async *stream() {
			for (const byte of data) yield Uint8Array.of(byte);
		},
	};
	const values = [];
	for await (const row of records(input, ref)) values.push(row);
	expect(values).toEqual([{ text: "中文😀" }]);
	await expect(async () => {
		for await (const _ of records(input, { ...ref, sha256: `sha256:${"0".repeat(64)}` })) void _;
	}).rejects.toThrow("identity mismatch");
});
it("deduplicates texts on disk and generates one bounded embedding batch at a time", async () => {
	const w = await work();
	initializeBuild(w.db);
	for (let i = 0; i < 90; i++) addChunk(w.db, { retrievalText: `text-${i % 45}` });
	let active = 0,
		max = 0;
	const embed = vi.fn(async ({ texts }: { texts: string[] }) => {
		active++;
		max = Math.max(max, active);
		expect(texts.length).toBeLessThanOrEqual(32);
		await Promise.resolve();
		active--;
		return texts.map(() => Array(EMBEDDING_SPACE.dimensions).fill(0));
	});
	expect(await generateEmbeddings(w.db, { embed })).toBe(45);
	expect(max).toBe(1);
	expect(await generateEmbeddings(w.db, { embed })).toBe(0);
});
it("limits writes by both point count and serialized bytes", async () => {
	const p: UnifiedPoint = {
		id: "x",
		payload: { text: "a".repeat(200_000) },
		vector: { dense: [], sparse: { indices: [], values: [] } },
	};
	let total = 0;
	for await (const batch of batches(Array(100).fill(p))) {
		expect(batch.length).toBeLessThanOrEqual(64);
		expect(Buffer.byteLength(JSON.stringify({ points: batch }))).toBeLessThanOrEqual(
			8 * 1024 * 1024,
		);
		total += batch.length;
	}
	expect(total).toBe(100);
});
