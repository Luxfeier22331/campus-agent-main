import { describe, expect, it } from "vitest";

import { noticeClassificationKey } from "../src/artifacts.ts";
import {
	NoticeClassificationJobError,
	runNoticeClassificationJob,
} from "../src/job.ts";
import type { NoticeClassifierObjectStore } from "../src/object-store.ts";

describe("notice classification job", () => {
	it("skips valid artifacts without constructing a model", async () => {
		const store = createStore([1, 2]);
		store.derived.set(
			noticeClassificationKey(1),
			json({ category: "campus_news", notice_id: 1, schema_version: "notice_classification.v1" }),
		);
		let factories = 0;
		const result = await runNoticeClassificationJob({
			createModelClassifier: () => {
				factories += 1;
				return async () => "campus_operations";
			},
			objectStore: store,
		});
		expect(result).toEqual({ classified: 1, requested: 2, skipped: 1 });
		expect(factories).toBe(1);
		expect(readCategory(store, 2)).toBe("campus_operations");
	});

	it("reprocesses invalid artifacts and explicitly reclassifies valid ones", async () => {
		const store = createStore([1, 2]);
		store.derived.set(noticeClassificationKey(1), new TextEncoder().encode("not-json"));
		store.derived.set(
			noticeClassificationKey(2),
			json({ category: "campus_news", notice_id: 2, schema_version: "notice_classification.v1" }),
		);
		let calls = 0;
		const result = await runNoticeClassificationJob({
			createModelClassifier: () => async () => {
				calls += 1;
				return "campus_operations";
			},
			noticeIds: [2],
			objectStore: store,
		});
		expect(result).toEqual({ classified: 1, requested: 1, skipped: 0 });
		expect(calls).toBe(1);
		expect(readCategory(store, 2)).toBe("campus_operations");

		const invalidResult = await runNoticeClassificationJob({
			createModelClassifier: () => async () => "research_affairs",
			objectStore: store,
		});
		expect(invalidResult).toEqual({ classified: 1, requested: 2, skipped: 1 });
		expect(readCategory(store, 1)).toBe("research_affairs");
	});

	it("does not require portal metadata or body fields before title classification", async () => {
		const store = createStore([1]);
		store.source.set(
			"internal_portal/notices/1.json",
			json({
				notice_content_html: 42,
				notice_id: 1,
				notice_title: "临时关闭校园南门",
				notice_type: null,
				schema_version: "internal_portal_notice_source.v2",
			}),
		);
		const result = await runNoticeClassificationJob({
			createModelClassifier: () => async () => "campus_operations",
			objectStore: store,
		});
		expect(result).toEqual({ classified: 1, requested: 1, skipped: 0 });
	});

	it("keeps classification concurrency at two and stops scheduling after a failure", async () => {
		const store = createStore([1, 2, 3, 4]);
		let active = 0;
		let maximum = 0;
		const started: string[] = [];
		await expect(
			runNoticeClassificationJob({
				concurrency: 2,
				createModelClassifier: () => async (noticeTitle) => {
					started.push(noticeTitle);
					active += 1;
					maximum = Math.max(maximum, active);
					if (noticeTitle === "通知 1") {
						active -= 1;
						throw new Error("permanent provider failure");
					}
					await new Promise((resolve) => setTimeout(resolve, 10));
					active -= 1;
					return "campus_operations";
				},
				objectStore: store,
			}),
		).rejects.toBeInstanceOf(NoticeClassificationJobError);
		expect(maximum).toBeLessThanOrEqual(2);
		expect(started).toEqual(["通知 1", "通知 2"]);
		expect(readCategory(store, 2)).toBe("campus_operations");
		expect(readCategory(store, 3)).toBeUndefined();
		expect(readCategory(store, 4)).toBeUndefined();
	});
});

function createStore(ids: readonly number[]): TestStore {
	const source = new Map<string, Uint8Array>();
	for (const noticeId of ids) {
		source.set(
			`internal_portal/notices/${noticeId}.json`,
			json({
				attachments: [],
				external_url: null,
				is_external: false,
				notice_content_html: null,
				notice_id: noticeId,
				notice_release_time: null,
				notice_title: `通知 ${noticeId}`,
				notice_type: 1,
				organization_id: null,
				schema_version: "internal_portal_notice_source.v2",
			}),
		);
	}
	const derived = new Map<string, Uint8Array>();
	return {
		close() {},
		derived,
		async getDerived(key) {
			return derived.get(key) ?? null;
		},
		async getSource(key) {
			const value = source.get(key);
			if (!value) throw new Error(`missing source object: ${key}`);
			return value;
		},
		async listSource(prefix) {
			return [...source.keys()].filter((key) => key.startsWith(prefix));
		},
		async putDerived(key, body) {
			derived.set(key, body);
		},
		source,
	};
}

type TestStore = NoticeClassifierObjectStore & {
	derived: Map<string, Uint8Array>;
	source: Map<string, Uint8Array>;
};

function readCategory(store: TestStore, noticeId: number): string | undefined {
	const bytes = store.derived.get(noticeClassificationKey(noticeId));
	if (!bytes) return undefined;
	return (JSON.parse(new TextDecoder().decode(bytes)) as { category?: string }).category;
}

function json(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}
