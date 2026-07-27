import { isDeepStrictEqual } from "node:util";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";
import {
	backfillInternalPortalNotices,
	type NoticeRunnerInput,
	parseNoticeStartDate,
	syncInternalPortalNotices,
} from "../src/notice-runner.js";
import type { InternalPortalNoticeSourceStore } from "../src/notice-source.js";
import type {
	InternalPortalNoticeSyncState,
	InternalPortalNoticeSyncStateStore,
} from "../src/notice-state-store.js";
import type { ApiRequestContextLike, NoticeItem, NoticeListResponse } from "../src/types.js";

const apiContext = {} as ApiRequestContextLike;
const now = "2026-07-26T01:00:00.000Z";

describe("notice runner", () => {
	it("bootstraps the fixed notice type without collecting deployed notices", async () => {
		const stateStore = new MemoryStateStore();
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async () => page([103, 102], 8));
		const fetchNoticeDetail = detailFetcher();

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticeDetail, fetchNoticePage, sourceStore, stateStore }),
		);

		expect(fetchNoticePage).toHaveBeenCalledOnce();
		expect(fetchNoticePage).toHaveBeenCalledWith(
			expect.objectContaining({ currentPage: 1, startDate: "" }),
		);
		expect(fetchNoticeDetail).not.toHaveBeenCalled();
		expect(sourceStore.sources).toHaveLength(0);
		expect(result).toMatchObject({
			mode: "sync",
			objectsReused: 0,
			objectsWritten: 0,
			pagesFetched: 1,
		});
		expect(result.state).toEqual(state({ incrementalHeadId: 103, updatedAt: now }));
	});

	it("captures the first notices that appear after an empty deployment baseline", async () => {
		const stateStore = new MemoryStateStore();
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi
			.fn()
			.mockResolvedValueOnce(page([], 0))
			.mockResolvedValueOnce(page([103, 102], 2));
		const fetchNoticeDetail = detailFetcher();
		const input = runnerInput({
			fetchNoticeDetail,
			fetchNoticePage,
			sourceStore,
			stateStore,
		});

		const baseline = await syncInternalPortalNotices(input);
		const result = await syncInternalPortalNotices(input);

		expect(baseline.state).toEqual(state({ incrementalHeadId: null, updatedAt: now }));
		expect(fetchNoticeDetail.mock.calls.map(([call]) => call.noticeId)).toEqual([102, 103]);
		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([102, 103]);
		expect(result.state).toEqual(
			state({
				incrementalHeadId: 103,
				maxCapturedId: 103,
				minCapturedId: 102,
				updatedAt: now,
			}),
		);
	});

	it("collects ids above the exact head across totalCounts-derived pages", async () => {
		const stateStore = new MemoryStateStore([state({ incrementalHeadId: 101 })]);
		const sourceStore = new MemorySourceStore();
		const firstPageIds = Array.from({ length: 20 }, (_, index) => 121 - index);
		const fetchNoticePage = vi.fn(async ({ currentPage }) =>
			currentPage === 1 ? page(firstPageIds, 21) : page([101], 21),
		);
		const fetchNoticeDetail = detailFetcher();

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticeDetail, fetchNoticePage, sourceStore, stateStore }),
		);

		expect(fetchNoticePage).toHaveBeenCalledTimes(2);
		expect(fetchNoticeDetail.mock.calls.map(([call]) => call.noticeId)).toEqual(
			[...firstPageIds].reverse(),
		);
		expect(result).toMatchObject({ objectsReused: 0, objectsWritten: 20, pagesFetched: 2 });
		expect(result.state).toEqual(
			state({
				incrementalHeadId: 121,
				maxCapturedId: 121,
				minCapturedId: 102,
				updatedAt: now,
			}),
		);
	});

	it("does not write objects or state when the first item is the current head", async () => {
		const current = state({ incrementalHeadId: 100, maxCapturedId: 100, minCapturedId: 90 });
		const stateStore = new MemoryStateStore([current]);
		const sourceStore = new MemorySourceStore();

		const result = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticePage: async () => page([100, 99], 2),
				sourceStore,
				stateStore,
			}),
		);

		expect(result).toMatchObject({ objectsReused: 0, objectsWritten: 0, pagesFetched: 1 });
		expect(result.state).toEqual(current);
		expect(stateStore.saveCalls).toBe(0);
	});

	it.each([
		{
			error: "out of descending order",
			ids: [105, 106],
			name: "out-of-order ids",
			totalItems: 2,
		},
		{
			error: "passed incremental head 100",
			ids: [105, 99],
			name: "a scan that passes the head",
			totalItems: 2,
		},
		{
			error: "did not return incremental head 100",
			ids: [105, 104],
			name: "a scan that omits the head",
			totalItems: 2,
		},
	])("fails without moving state for $name", async ({ error, ids, totalItems }) => {
		const current = state({ incrementalHeadId: 100 });
		const stateStore = new MemoryStateStore([current]);
		const sourceStore = new MemorySourceStore();

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticePage: async () => page(ids, totalItems),
					sourceStore,
					stateStore,
				}),
			),
		).rejects.toThrow(error);

		expect(stateStore.saveCalls).toBe(0);
		expect(sourceStore.sources).toHaveLength(0);
	});

	it("captures the current head and older notices on a first backfill", async () => {
		const stateStore = new MemoryStateStore();
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async ({ startDate }) => {
			expect(startDate).toBe("2026-01-01");
			return page([103, 102, 101], 3);
		});

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticePage, sourceStore, stateStore }),
			startDate: "2026-01-01",
		});

		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([101, 102, 103]);
		expect(result.state).toEqual(
			state({
				historyCoveredFrom: "2026-01-01",
				incrementalHeadId: 103,
				maxCapturedId: 103,
				minCapturedId: 101,
				updatedAt: now,
			}),
		);
	});

	it("establishes the current head when a first backfill date returns no notices", async () => {
		const stateStore = new MemoryStateStore();
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async ({ startDate }) =>
			startDate ? page([], 0) : page([103, 102], 2),
		);
		const fetchNoticeDetail = detailFetcher();

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticeDetail, fetchNoticePage, sourceStore, stateStore }),
			startDate: "2027-01-01",
		});

		expect(fetchNoticePage).toHaveBeenCalledTimes(2);
		expect(fetchNoticeDetail).not.toHaveBeenCalled();
		expect(sourceStore.sources).toHaveLength(0);
		expect(result).toMatchObject({ objectsWritten: 0, pagesFetched: 2 });
		expect(result.state).toEqual(
			state({
				historyCoveredFrom: "2027-01-01",
				incrementalHeadId: 103,
				updatedAt: now,
			}),
		);
	});

	it("extends history only below the recorded minimum id", async () => {
		const stateStore = new MemoryStateStore([
			state({ incrementalHeadId: 105, maxCapturedId: 105, minCapturedId: 104 }),
		]);
		const sourceStore = new MemorySourceStore();

		const result = await backfillInternalPortalNotices({
			...runnerInput({
				fetchNoticePage: async () => page([105, 104, 103, 102], 4),
				sourceStore,
				stateStore,
			}),
			startDate: "2025-09-01",
		});

		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([102, 103]);
		expect(result.state).toEqual(
			state({
				historyCoveredFrom: "2025-09-01",
				incrementalHeadId: 105,
				maxCapturedId: 105,
				minCapturedId: 102,
				updatedAt: now,
			}),
		);
	});

	it("returns an already-covered backfill without portal requests or state writes", async () => {
		const current = state({ historyCoveredFrom: "2025-01-01", incrementalHeadId: 105 });
		const stateStore = new MemoryStateStore([current]);
		const fetchNoticePage = vi.fn();
		const fetchNoticeDetail = vi.fn();

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticeDetail, fetchNoticePage, stateStore }),
			startDate: "2026-01-01",
		});

		expect(result).toEqual({
			mode: "backfill",
			objectsReused: 0,
			objectsWritten: 0,
			pagesFetched: 0,
			state: current,
		});
		expect(fetchNoticePage).not.toHaveBeenCalled();
		expect(fetchNoticeDetail).not.toHaveBeenCalled();
		expect(stateStore.saveCalls).toBe(0);
	});

	it("reuses a verified object when the state write failed", async () => {
		const stateStore = new MemoryStateStore([state({ incrementalHeadId: 100 })]);
		stateStore.failNextSave = true;
		const sourceStore = new MemorySourceStore();
		const fetchNoticeDetail = detailFetcher();
		const input = runnerInput({
			fetchNoticeDetail,
			fetchNoticePage: async () => page([101, 100], 2),
			sourceStore,
			stateStore,
		});

		await expect(syncInternalPortalNotices(input)).rejects.toThrow("state save failed");
		const rerun = await syncInternalPortalNotices(input);

		expect(fetchNoticeDetail).toHaveBeenCalledTimes(2);
		expect(sourceStore.sources).toHaveLength(1);
		expect(rerun).toMatchObject({ objectsReused: 1, objectsWritten: 0 });
		expect(rerun.state).toMatchObject({
			incrementalHeadId: 101,
			maxCapturedId: 101,
			minCapturedId: 101,
		});
	});

	it("validates explicit history dates", () => {
		expect(parseNoticeStartDate("2026-02-28")).toBe("2026-02-28");
		expect(() => parseNoticeStartDate("2026-02-29")).toThrow("valid calendar date");
		expect(() => parseNoticeStartDate("2026/02/28")).toThrow("YYYY-MM-DD");
	});
});

class MemoryStateStore implements InternalPortalNoticeSyncStateStore {
	failNextSave = false;
	saveCalls = 0;
	readonly #states = new Map<string, InternalPortalNoticeSyncState>();

	constructor(states: InternalPortalNoticeSyncState[] = []) {
		for (const value of states) {
			this.#states.set(value.siteId, structuredClone(value));
		}
	}

	async load(siteId: string): Promise<InternalPortalNoticeSyncState | null> {
		const value = this.#states.get(siteId);
		return value ? structuredClone(value) : null;
	}

	async save(value: InternalPortalNoticeSyncState): Promise<void> {
		this.saveCalls += 1;
		if (this.failNextSave) {
			this.failNextSave = false;
			throw new Error("state save failed");
		}
		this.#states.set(value.siteId, structuredClone(value));
	}
}

class MemorySourceStore implements InternalPortalNoticeSourceStore {
	readonly sources: InternalPortalNoticeSource[] = [];

	async put(source: InternalPortalNoticeSource): Promise<"reused" | "written"> {
		const existing = this.sources.find((candidate) => candidate.notice_id === source.notice_id);
		if (existing) {
			if (!isDeepStrictEqual(existing, source)) {
				throw new Error("stored notice differs");
			}
			return "reused";
		}
		this.sources.push(structuredClone(source));
		return "written";
	}
}

function runnerInput(overrides: Partial<NoticeRunnerInput> = {}): NoticeRunnerInput {
	return {
		apiContext,
		fetchNoticeDetail: detailFetcher(),
		fetchNoticePage: async () => page([], 0),
		now: () => now,
		siteId: "muc_internal_portal",
		sourceStore: new MemorySourceStore(),
		stateStore: new MemoryStateStore(),
		...overrides,
	};
}

function page(ids: number[], totalItems: number): NoticeListResponse {
	return {
		datas: {
			page: { totalCounts: totalItems },
			tables: ids.map((id) => notice(id)),
		},
		state: true,
	};
}

function notice(noticeId: number): NoticeItem {
	return { notice_id: noticeId };
}

function detailFetcher() {
	return vi.fn(async ({ noticeId }: { noticeId: number }) => ({
		datas: {
			notice_info: {
				notice_content: `<p>${noticeId}</p>`,
				notice_id: noticeId,
				notice_release_time: "2026-07-25 08:00",
				notice_title: `通知 ${noticeId}`,
				notice_type_name: "办公通知",
			},
		},
		state: true,
	}));
}

function state(
	overrides: Partial<InternalPortalNoticeSyncState> = {},
): InternalPortalNoticeSyncState {
	return {
		historyCoveredFrom: null,
		incrementalHeadId: null,
		maxCapturedId: null,
		minCapturedId: null,
		siteId: "muc_internal_portal",
		updatedAt: "2026-07-25T00:00:00.000Z",
		...overrides,
	};
}
