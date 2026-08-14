import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";
import type { InternalPortalNoticeMetaStore } from "../src/notice-meta-store.js";
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
import type {
	ApiRequestContextLike,
	NoticeItem,
	NoticeListResponse,
	NoticeMetadataResponse,
} from "../src/types.js";

const apiContext = {} as ApiRequestContextLike;
const now = "2026-08-11T02:30:07.000Z";

describe("notice runner", () => {
	it("bootstraps the unfiltered portal head and metadata without collecting deployed notices", async () => {
		const stateStore = new MemoryStateStore();
		const sourceStore = new MemorySourceStore();
		const metaStore = new MemoryMetaStore();
		const fetchNoticePage = vi.fn(async () => page([notice(358195, 36), notice(358194, 1)], 2));
		const fetchNoticeDetail = detailFetcher();

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticeDetail, fetchNoticePage, metaStore, sourceStore, stateStore }),
		);

		expect(fetchNoticeDetail).not.toHaveBeenCalled();
		expect(sourceStore.sources).toHaveLength(0);
		expect(metaStore.value).toEqual({
			noticeTypes: expectedNoticeTypes(),
			organizations: { "00007": "党委保卫部、保卫处" },
			updatedAt: now,
		});
		expect(result.state).toEqual(state({ headNoticeId: 358195, updatedAt: now }));
	});

	it("collects selector types across pages and ignores news aggregation types", async () => {
		const current = state({ headNoticeId: 100 });
		const stateStore = new MemoryStateStore(current);
		const sourceStore = new MemorySourceStore();
		const selectedTypes = Object.keys(expectedNoticeTypes()).map(Number);
		const firstPage = Array.from({ length: 20 }, (_, index) =>
			notice(
				120 - index,
				index < 3 ? ([1, 4, 9][index] ?? 1) : (selectedTypes[index % selectedTypes.length] ?? 5),
			),
		);
		const fetchNoticePage = vi.fn(async ({ currentPage }) =>
			currentPage === 1 ? page(firstPage, 21) : page([notice(100, 5)], 21),
		);

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticePage, sourceStore, stateStore }),
		);

		expect(fetchNoticePage).toHaveBeenCalledTimes(2);
		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual(
			firstPage
				.filter((item) => ![1, 4, 9].includes(Number(item.notice_type)))
				.map((item) => item.notice_id),
		);
		expect(result).toMatchObject({ objectsWritten: 17, pagesFetched: 2 });
		expect(result.state).toEqual(state({ headNoticeId: 120, updatedAt: now }));
	});

	it("uses portal order rather than numeric id order to find the current head", async () => {
		const stateStore = new MemoryStateStore(state({ headNoticeId: 100 }));
		const sourceStore = new MemorySourceStore();

		const result = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticePage: async () =>
					page([notice(105, 5), notice(99, 5), notice(106, 36), notice(100, 5)], 4),
				sourceStore,
				stateStore,
			}),
		);

		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([105, 99, 106]);
		expect(result.state.headNoticeId).toBe(105);
	});

	it.each([
		{
			error: "did not return head 100",
			items: [notice(105, 5), notice(104, 5)],
			name: "a scan that omits the head",
		},
		{
			error: "invalid notice_type",
			items: [{ notice_id: 105 }, notice(100, 5)],
			name: "missing type metadata",
		},
	])("fails without moving state for $name", async ({ error, items }) => {
		const current = state({ headNoticeId: 100 });
		const stateStore = new MemoryStateStore(current);
		const sourceStore = new MemorySourceStore();

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticePage: async () => page(items, items.length),
					sourceStore,
					stateStore,
				}),
			),
		).rejects.toThrow(error);

		expect(stateStore.saveCalls).toBe(0);
		expect(sourceStore.sources).toHaveLength(0);
	});

	it("deduplicates overlapping portal pages by notice id", async () => {
		const stateStore = new MemoryStateStore(state({ headNoticeId: 100 }));
		const sourceStore = new MemorySourceStore();

		const result = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticePage: async () => page([notice(105, 5), notice(105, 5), notice(100, 5)], 3),
				sourceStore,
				stateStore,
			}),
		);

		expect(sourceStore.sources.map((item) => item.notice_id)).toEqual([105]);
		expect(result.state.headNoticeId).toBe(105);
	});

	it("backfills selected notices and skips details for an existing v2 object", async () => {
		const existing = source(358159, 5);
		const sourceStore = new MemorySourceStore([existing]);
		const stateStore = new MemoryStateStore(state({ headNoticeId: 358200 }));
		const fetchNoticeDetail = detailFetcher();

		const result = await backfillInternalPortalNotices({
			...runnerInput({
				fetchNoticeDetail,
				fetchNoticePage: async () =>
					page([notice(358159, 5), notice(358158, 1), notice(358157, 36)], 3),
				sourceStore,
				stateStore,
			}),
			startDate: "2026-08-03",
		});

		expect(fetchNoticeDetail.mock.calls.map(([call]) => call.noticeId)).toEqual([358157]);
		expect(sourceStore.sources.map((item) => item.notice_id)).toEqual([358159, 358157]);
		expect(sourceStore.sources[1]).toMatchObject({
			external_url: "https://example.edu/external",
			is_external: true,
		});
		expect(result).toMatchObject({ objectsReused: 1, objectsWritten: 1 });
		expect(result.state).toEqual(
			state({
				headNoticeId: 358200,
				historyCoveredFrom: "2026-08-03",
				updatedAt: now,
			}),
		);
	});

	it("returns an already-covered backfill without portal requests", async () => {
		const current = state({ headNoticeId: 358200, historyCoveredFrom: "2026-01-01" });
		const stateStore = new MemoryStateStore(current);
		const fetchNoticeMetadata = vi.fn();
		const fetchNoticePage = vi.fn();

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticeMetadata, fetchNoticePage, stateStore }),
			startDate: "2026-08-03",
		});

		expect(result.state).toEqual(current);
		expect(fetchNoticeMetadata).not.toHaveBeenCalled();
		expect(fetchNoticePage).not.toHaveBeenCalled();
		expect(stateStore.saveCalls).toBe(0);
	});

	it("reuses an existing object without repeating detail after a state write failure", async () => {
		const stateStore = new MemoryStateStore(state({ headNoticeId: 100 }));
		stateStore.failNextSave = true;
		const sourceStore = new MemorySourceStore();
		const fetchNoticeDetail = detailFetcher();
		const input = runnerInput({
			fetchNoticeDetail,
			fetchNoticePage: async () => page([notice(101, 5), notice(100, 5)], 2),
			sourceStore,
			stateStore,
		});

		await expect(syncInternalPortalNotices(input)).rejects.toThrow("state save failed");
		const rerun = await syncInternalPortalNotices(input);

		expect(fetchNoticeDetail).toHaveBeenCalledOnce();
		expect(rerun).toMatchObject({ objectsReused: 1, objectsWritten: 0 });
		expect(rerun.state.headNoticeId).toBe(101);
	});

	it("does not advance state when metadata persistence fails", async () => {
		const stateStore = new MemoryStateStore(state({ headNoticeId: 100 }));
		const metaStore = new MemoryMetaStore();
		metaStore.failNextPut = true;

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticePage: async () => page([notice(101, 5), notice(100, 5)], 2),
					metaStore,
					stateStore,
				}),
			),
		).rejects.toThrow("metadata save failed");
		expect(stateStore.saveCalls).toBe(0);
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
	#state: InternalPortalNoticeSyncState | null;

	constructor(state: InternalPortalNoticeSyncState | null = null) {
		this.#state = state ? structuredClone(state) : null;
	}

	async load(): Promise<InternalPortalNoticeSyncState | null> {
		return this.#state ? structuredClone(this.#state) : null;
	}

	async save(value: InternalPortalNoticeSyncState): Promise<void> {
		this.saveCalls += 1;
		if (this.failNextSave) {
			this.failNextSave = false;
			throw new Error("state save failed");
		}
		this.#state = structuredClone(value);
	}
}

class MemoryMetaStore implements InternalPortalNoticeMetaStore {
	failNextPut = false;
	value: {
		noticeTypes: Record<string, string>;
		organizations: Record<string, string>;
		updatedAt: string;
	} | null = null;

	async putMappings(value: NonNullable<MemoryMetaStore["value"]>): Promise<"written"> {
		if (this.failNextPut) {
			this.failNextPut = false;
			throw new Error("metadata save failed");
		}
		this.value = structuredClone(value);
		return "written";
	}
}

class MemorySourceStore implements InternalPortalNoticeSourceStore {
	readonly sources: InternalPortalNoticeSource[];

	constructor(sources: InternalPortalNoticeSource[] = []) {
		this.sources = structuredClone(sources);
	}

	async has(noticeId: number): Promise<boolean> {
		return this.sources.some((candidate) => candidate.notice_id === noticeId);
	}

	async put(sourceValue: InternalPortalNoticeSource): Promise<"reused" | "written"> {
		if (await this.has(sourceValue.notice_id)) {
			return "reused";
		}
		this.sources.push(structuredClone(sourceValue));
		return "written";
	}
}

function runnerInput(overrides: Partial<NoticeRunnerInput> = {}): NoticeRunnerInput {
	return {
		apiContext,
		fetchNoticeDetail: detailFetcher(),
		fetchNoticeMetadata: async () => metadata(),
		fetchNoticePage: async () => page([], 0),
		metaStore: new MemoryMetaStore(),
		now: () => now,
		sourceStore: new MemorySourceStore(),
		stateStore: new MemoryStateStore(),
		...overrides,
	};
}

function page(items: NoticeItem[], totalItems: number): NoticeListResponse {
	return {
		datas: {
			page: {
				pageSize: 20,
				total: totalItems,
				totalCounts: Math.ceil(totalItems / 20),
			},
			tables: items,
		},
		state: true,
	};
}

function notice(noticeId: number, noticeType: number): NoticeItem {
	return {
		notice_id: noticeId,
		notice_link: noticeType === 36 ? "https://example.edu/external" : null,
		notice_type: noticeType,
		organization_id: "00007",
		organization_name: "党委保卫部、保卫处",
	};
}

function metadata(): NoticeMetadataResponse {
	return {
		datas: {
			org: [{ organization_id: "00007", organization_name: "党委保卫部、保卫处" }],
			type: [
				...Object.entries(expectedNoticeTypes()).map(([noticeTypeId, noticeTypeName]) => ({
					notice_type_id: Number(noticeTypeId),
					notice_type_name: noticeTypeName,
				})),
			],
		},
		state: true,
	};
}

function expectedNoticeTypes(): Record<string, string> {
	return {
		"5": "办公通知",
		"6": "教学通知",
		"8": "科研通知",
		"10": "就业信息",
		"11": "公示公告",
		"32": "学工通知",
		"36": "活动报道",
		"9978": "会议纪要",
		"9979": "民大要情",
		"9980": "学术信息",
		"9982": "常用下载",
	};
}

function detailFetcher() {
	return vi.fn(async ({ noticeId }: { noticeId: number }) => ({
		datas: {
			notice_info: {
				notice_content: `<p>${noticeId}</p>`,
				notice_id: noticeId,
				notice_release_time: "2026-08-03 11:57",
				notice_title: `通知 ${noticeId}`,
			},
		},
		state: true,
	}));
}

function source(noticeId: number, noticeType: number): InternalPortalNoticeSource {
	return {
		attachments: [],
		external_url: null,
		is_external: false,
		notice_content_html: `<p>${noticeId}</p>`,
		notice_id: noticeId,
		notice_release_time: "2026-08-03 11:57",
		notice_title: `通知 ${noticeId}`,
		notice_type: noticeType,
		organization_id: "00007",
		schema_version: "internal_portal_notice_source.v2",
	};
}

function state(
	overrides: Partial<InternalPortalNoticeSyncState> = {},
): InternalPortalNoticeSyncState {
	return {
		headNoticeId: null,
		historyCoveredFrom: null,
		updatedAt: "2026-08-10T00:00:00.000Z",
		...overrides,
	};
}
