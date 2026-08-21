import { describe, expect, it, vi } from "vitest";

import {
	parseClassifications,
	resolvePublishClassifications,
} from "../src/classifications.ts";
import type { PublisherObjectStore } from "../src/store.ts";

describe("notice publisher classification inventory", () => {
	it("accepts unclassified as a valid online artifact", async () => {
		const store = inventoryStore({
			artifacts: { 1: artifact(1, "unclassified") },
			sourceIds: [1],
		});
		await expect(
			resolvePublishClassifications({ objectStore: store }),
		).resolves.toEqual([{ category: "unclassified", noticeId: 1 }]);
	});

	it("rejects missing and extra artifacts before loading notice bodies", async () => {
		const store = inventoryStore({
			artifacts: { 1: artifact(1, "campus_news"), 3: artifact(3, "governance") },
			sourceIds: [1, 2],
		});
		await expect(
			resolvePublishClassifications({ objectStore: store }),
		).rejects.toThrow(
			"notice classification inventory mismatch: missing=[2], extra=[3]",
		);
		expect(store.getDerived).not.toHaveBeenCalled();
	});

	it("rejects an artifact whose identity differs from its key", async () => {
		const store = inventoryStore({
			artifacts: { 1: artifact(2, "campus_news") },
			sourceIds: [1],
		});
		await expect(
			resolvePublishClassifications({ objectStore: store }),
		).rejects.toThrow("notices/classifications/1.json has mismatched notice_id");
	});

	it("loads only explicitly selected artifact ids", async () => {
		const store = inventoryStore({
			artifacts: { 2: artifact(2, "teaching_affairs") },
			sourceIds: [],
		});
		await expect(
			resolvePublishClassifications({ noticeIds: [2], objectStore: store }),
		).resolves.toEqual([{ category: "teaching_affairs", noticeId: 2 }]);
		expect(store.listSource).not.toHaveBeenCalled();
		expect(store.listDerived).not.toHaveBeenCalled();
	});

	it("requires local JSONL to cover the full source inventory", async () => {
		const store = inventoryStore({ artifacts: {}, sourceIds: [1, 2] });
		await expect(
			resolvePublishClassifications({
				classifications: parseClassifications(
					'{"notice_id":1,"category":"campus_news"}\n',
				),
				objectStore: store,
			}),
		).rejects.toThrow(
			"notice classification inventory mismatch: missing=[2], extra=[]",
		);
	});
});

function artifact(noticeId: number, category: string): Uint8Array {
	return Buffer.from(
		JSON.stringify({
			category,
			notice_id: noticeId,
			schema_version: "notice_classification.v1",
		}),
	);
}

function inventoryStore(input: {
	artifacts: Record<number, Uint8Array>;
	sourceIds: number[];
}): PublisherObjectStore {
	return {
		close: vi.fn(),
		createOrVerifyDerived: vi.fn(),
		getDerived: vi.fn(async (key: string) => {
			const match = /notices\/classifications\/([1-9][0-9]*)\.json$/u.exec(key);
			const body = match ? input.artifacts[Number(match[1])] : undefined;
			return body ? { body, contentType: "application/json" } : null;
		}),
		getSource: vi.fn(async () => {
			throw new Error("unexpected source read");
		}),
		listDerived: vi.fn(async () =>
			Object.keys(input.artifacts).map((id) => `notices/classifications/${id}.json`),
		),
		listSource: vi.fn(async () => [
			...input.sourceIds.map((id) => `internal_portal/notices/${id}.json`),
			"internal_portal/notices/_state.json",
		]),
	};
}
