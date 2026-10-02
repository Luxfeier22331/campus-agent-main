import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNoticeChunkRun, readNoticeEmbeddingSetManifest } from "../src/artifacts.ts";

const mocks = vi.hoisted(() => ({
	acquirePublisherLock: vi.fn(),
	activate: vi.fn(),
	close: vi.fn(),
	qdrant: vi.fn(),
	publish: vi.fn(),
	controller: new AbortController(),
}));
vi.mock("../src/catalog.ts", () => ({
	createPostgresIndexCatalog: () => ({
		acquirePublisherLock: mocks.acquirePublisherLock,
		activate: mocks.activate,
		close: mocks.close,
		signal: mocks.controller.signal,
	}),
}));
vi.mock("../src/qdrant.ts", () => ({ createQdrantClient: mocks.qdrant }));
vi.mock("../src/publisher.ts", () => ({ publishCampusRagIndex: mocks.publish }));

import { runCampusRagRollback } from "../src/run.ts";

const input = {
	collection: `campus_docs_${"a".repeat(64)}`,
	expectedCurrent: `campus_docs_${"b".repeat(64)}`,
};

describe("rollback runner", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.controller = new AbortController();
	});

	it("activates the pinned collection even when its v1 artifacts lack publication dates", async () => {
		const store = {
			read: vi.fn((key: string) => readFile(new URL(
				`../../../scripts/dev/product-data/fixtures/product-data/${key}`, import.meta.url,
			))),
		};
		const set = await readNoticeEmbeddingSetManifest(store,
			"sha256:71d18b5a3745a59072d8338f5229709c8430d47ba3494038ce557a6446b9d891");
		if (set.schemaVersion !== "notice_embedding_set.v1") throw new Error("expected legacy fixture");
		const run = await readNoticeChunkRun(store, set.chunkRun);
		expect(run.chunks.length).toBeGreaterThan(0);
		expect(run.chunks.every((chunk) => chunk.releasedAt === undefined)).toBe(true);
		store.read.mockClear();
		mocks.activate.mockResolvedValue({ noOp: false });
		expect(await runCampusRagRollback(input)).toEqual({ collection: input.collection, noOp: false });
		expect(mocks.acquirePublisherLock).toHaveBeenCalledOnce();
		expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(input);
		expect(mocks.acquirePublisherLock.mock.invocationCallOrder[0]).toBeLessThan(mocks.activate.mock.invocationCallOrder[0]!);
		expect(mocks.close).toHaveBeenCalledOnce();
		expect(store.read).not.toHaveBeenCalled();
		expect(mocks.publish).not.toHaveBeenCalled();
		expect(mocks.qdrant).not.toHaveBeenCalled();
	});

	it.each([{ noOp: true }, { noOp: true, obsolete: true }])("preserves activation result %j", async (result) => {
		mocks.activate.mockResolvedValue(result);
		expect(await runCampusRagRollback(input)).toEqual({ collection: input.collection, ...result });
		expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(input);
		expect(mocks.close).toHaveBeenCalledOnce();
	});

	it.each(["activity", "catalog"])("does not activate after %s cancellation", async (source) => {
		const controller = source === "catalog" ? mocks.controller : new AbortController();
		mocks.acquirePublisherLock.mockImplementation(() => controller.abort(new Error("cancelled")));
		await expect(runCampusRagRollback({ ...input, ...(source === "activity" ? { signal: controller.signal } : {}) })).rejects.toThrow("cancelled");
		expect(mocks.activate).not.toHaveBeenCalled();
		expect(mocks.close).toHaveBeenCalledOnce();
	});

	it.each(["acquirePublisherLock", "activate"] as const)("closes the catalog when %s fails", async (operation) => {
		mocks[operation].mockRejectedValue(new Error("failed"));
		await expect(runCampusRagRollback(input)).rejects.toThrow("failed");
		if (operation === "acquirePublisherLock") expect(mocks.activate).not.toHaveBeenCalled();
		expect(mocks.close).toHaveBeenCalledOnce();
	});
});
