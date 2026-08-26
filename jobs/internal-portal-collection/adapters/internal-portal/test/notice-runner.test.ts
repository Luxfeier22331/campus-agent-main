import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import type { InternalPortalNoticeMetaStore } from "../src/notice-meta-store.js";
import type {
	NoticeInventoryMappings,
	NoticeInventoryStore,
} from "../src/notice-inventory-store.js";
import {
	backfillInternalPortalNotices,
	parseNoticeStartDate,
	syncInternalPortalNotices,
	type NoticeRunnerInput,
} from "../src/notice-runner.js";
import type { InternalPortalNoticeSourceStore } from "../src/notice-source.js";
import type {
	InternalPortalNoticeSyncState,
	InternalPortalNoticeSyncStateStore,
} from "../src/notice-state-store.js";
import type {
	ApiRequestContextLike,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
	NoticeMetadataResponse,
} from "../src/types.js";

const apiContext = {} as ApiRequestContextLike;
const now = "2026-08-26T02:30:07.000Z";

describe("notice runner maintenance ranges", () => {
	it("initializes a complete range from the explicit backfill date to the portal latest date", async () => {
		const stateStore = new MemoryStateStore();
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async (input: { startDate: string; endDate: string }) => {
			if (input.startDate === "" && input.endDate === "") {
				return page([notice(300, 5, "2026-08-26 09:00")], 1);
			}
			return page([notice(200, 5, "2025-12-01 09:00")], 1);
		});

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticePage, sourceStore, stateStore }),
			startDate: "2025-12-01",
		});

		expect(fetchNoticePage.mock.calls.map(([input]) => input)).toEqual([
			{ apiContext, currentPage: 1, endDate: "", startDate: "" },
			{ apiContext, currentPage: 1, endDate: "2026-08-26", startDate: "2025-12-01" },
		]);
		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([200]);
		expect(result.range).toEqual({ from: "2025-12-01", to: "2026-08-27" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2025-12-01", coveredUntil: "2026-08-27", updatedAt: now }),
		);
	});

	it("syncs only the gap after covered_until and advances the exclusive upper bound", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async (input: { startDate: string; endDate: string }) => {
			if (input.startDate === "" && input.endDate === "") {
				return page([notice(300, 5, "2026-08-11 09:00")], 1);
			}
			return page([notice(101, 5, "2026-08-10 09:00"), notice(102, 5, "2026-08-11 09:00")], 2);
		});

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticePage, sourceStore, stateStore }),
		);

		expect(fetchNoticePage.mock.calls.map(([input]) => input)).toEqual([
			{ apiContext, currentPage: 1, endDate: "", startDate: "" },
			{ apiContext, currentPage: 1, endDate: "2026-08-11", startDate: "2026-08-10" },
		]);
		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([101, 102]);
		expect(result.range).toEqual({ from: "2026-08-10", to: "2026-08-12" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-12", updatedAt: now }),
		);
	});

	it("extends a complete range backwards without overlapping the maintained upper range", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-10", coveredUntil: "2026-08-27" }),
		);
		const fetchNoticePage = vi.fn(async (input: { startDate: string; endDate: string }) => {
			expect(input).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-09" });
			return page([notice(90, 5, "2026-08-01 09:00")], 1);
		});

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticePage, stateStore }),
			startDate: "2026-08-01",
		});

		expect(result.range).toEqual({ from: "2026-08-01", to: "2026-08-10" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-27", updatedAt: now }),
		);
	});

	it("enforces the half-open boundary using the detail release date", async () => {
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async () =>
			page([notice(1, 5, "2026-08-10 00:01"), notice(2, 5, "2026-08-11 00:01")], 2),
		);
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
			detail(noticeId, noticeId === 1 ? "2026-08-10 00:01" : "2026-08-11 00:01"),
		);

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticeDetail, fetchNoticePage, sourceStore }),
			startDate: "2026-08-10",
		});

		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([1]);
		expect(result.noticesProcessed).toBe(1);
	});

	it("does not move state when inventory writing fails", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const fetchNoticePage = vi.fn(async (input: { startDate: string; endDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page([notice(101, 5, "2026-08-10 09:00")], 1),
		);

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticePage,
					inventoryStore: new FailingInventoryStore(),
					stateStore,
				}),
			),
		).rejects.toThrow("inventory write failed");
		expect(stateStore.saveCalls).toBe(0);
	});

	it("requires an explicit backfill before a sync can use a missing upper bound", async () => {
		await expect(
			syncInternalPortalNotices(runnerInput({ stateStore: new MemoryStateStore(null) })),
		).rejects.toThrow("complete maintenance range");
		await expect(
			syncInternalPortalNotices(
				runnerInput({
					stateStore: new MemoryStateStore(
						state({ coveredFrom: "2026-01-01", coveredUntil: null }),
					),
				}),
			),
		).rejects.toThrow("complete maintenance range");
	});

	it("reuses a covered backfill without making portal requests", async () => {
		const fetchNoticePage = vi.fn();
		const fetchNoticeMetadata = vi.fn();
		const current = state({ coveredFrom: "2026-01-01", coveredUntil: "2026-08-27" });
		const result = await backfillInternalPortalNotices({
			...runnerInput({
				fetchNoticeMetadata,
				fetchNoticePage,
				stateStore: new MemoryStateStore(current),
			}),
			startDate: "2026-08-03",
		});

		expect(result).toMatchObject({ range: null, pagesFetched: 0, state: current });
		expect(fetchNoticeMetadata).not.toHaveBeenCalled();
		expect(fetchNoticePage).not.toHaveBeenCalled();
	});

	it("reports scanning, processing, writing, and finalizing progress", async () => {
		const progress: unknown[] = [];
		const result = await backfillInternalPortalNotices({
			...runnerInput({
				onProgress: (value) => progress.push(value),
				fetchNoticePage: async (input) =>
					input.startDate === ""
						? page([notice(300, 5, "2026-08-11 09:00")], 1)
						: page([notice(101, 5, "2026-08-10 09:00")], 1),
			}),
			startDate: "2026-08-10",
		});

		expect(result.range).toEqual({ from: "2026-08-10", to: "2026-08-12" });
		expect(progress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: "scanning" }),
				expect.objectContaining({ phase: "processing" }),
				expect.objectContaining({ phase: "writing" }),
				expect.objectContaining({ phase: "finalizing" }),
			]),
		);
	});

	it("writes Ops-compatible progress records with the range beside progress", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		let records: Record<string, unknown>[] = [];
		try {
			await backfillInternalPortalNotices({
				...runnerInput({
					fetchNoticePage: async (input) =>
						input.startDate === ""
							? page([notice(300, 5, "2026-08-11 09:00")], 1)
							: page([notice(101, 5, "2026-08-10 09:00")], 1),
				}),
				startDate: "2026-08-10",
			});
			records = log.mock.calls.map(
				([value]) => JSON.parse(String(value)) as Record<string, unknown>,
			);
		} finally {
			log.mockRestore();
		}

		expect(records.length).toBeGreaterThan(0);
		for (const record of records) {
			expect(record).toMatchObject({
				range: { from: "2026-08-10", to: "2026-08-12" },
				status: "running",
			});
			expect(record.progress).not.toHaveProperty("range");
		}
	});

	it("rebuilds a complete v3 range from a v2 migration input", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-01-01", coveredUntil: null }),
		);
		const fetchNoticePage = vi.fn(async (input: { startDate: string; endDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-26 09:00")], 1)
				: page([notice(200, 5, "2025-12-01 09:00")], 1),
		);

		const result = await backfillInternalPortalNotices({
			...runnerInput({ fetchNoticePage, stateStore }),
			startDate: "2025-12-01",
		});

		expect(result.range).toEqual({ from: "2025-12-01", to: "2026-08-27" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2025-12-01", coveredUntil: "2026-08-27", updatedAt: now }),
		);
	});

	it("validates explicit calendar dates", () => {
		expect(parseNoticeStartDate("2026-02-28")).toBe("2026-02-28");
		expect(() => parseNoticeStartDate("2026-02-29")).toThrow("valid calendar date");
		expect(() => parseNoticeStartDate("2026/02/28")).toThrow("YYYY-MM-DD");
	});
});

class MemoryStateStore implements InternalPortalNoticeSyncStateStore {
	saveCalls = 0;
	#state: InternalPortalNoticeSyncState | null;

	constructor(stateValue: InternalPortalNoticeSyncState | null = null) {
		this.#state = stateValue ? structuredClone(stateValue) : null;
	}

	async load(): Promise<InternalPortalNoticeSyncState | null> {
		return this.#state ? structuredClone(this.#state) : null;
	}

	async save(value: InternalPortalNoticeSyncState): Promise<void> {
		this.saveCalls += 1;
		this.#state = structuredClone(value);
	}
}

class MemoryMetaStore implements InternalPortalNoticeMetaStore {
	async putMappings(): Promise<"written"> {
		return "written";
	}
}

class MemoryInventoryStore implements NoticeInventoryStore {
	readonly mappings: NoticeInventoryMappings[] = [];

	async register(): Promise<"written"> {
		return "written";
	}

	async upsertMappings(mappings: NoticeInventoryMappings): Promise<void> {
		this.mappings.push(structuredClone(mappings));
	}
}

class MemorySourceStore implements InternalPortalNoticeSourceStore {
	readonly sources: InternalPortalNoticeSource[];

	constructor(initial: InternalPortalNoticeSource[] = []) {
		this.sources = structuredClone(initial);
	}

	async get(noticeId: number): Promise<InternalPortalNoticeSource | null> {
		const source = this.sources.find((candidate) => candidate.notice_id === noticeId);
		return source ? structuredClone(source) : null;
	}

	async has(noticeId: number): Promise<boolean> {
		return (await this.get(noticeId)) !== null;
	}

	async put(value: InternalPortalNoticeSource): Promise<"written"> {
		this.sources.push(structuredClone(value));
		return "written";
	}
}

class FailingInventoryStore extends MemoryInventoryStore {
	override async register(): Promise<"written"> {
		throw new Error("inventory write failed");
	}
}

class MemoryObjectStore implements InternalPortalCollectionObjectStore {
	readonly sourceBucket = "campus-agent-source";

	async createOrVerifyObject(): Promise<{ byteSize: number; contentSha256: string }> {
		return { byteSize: 0, contentSha256: "a" };
	}

	async createOrVerifyStream(input: {
		body: AsyncIterable<Uint8Array>;
		byteSize: number;
		contentSha256: string;
		key: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		for await (const _chunk of input.body) {
			// Drain the source stream in the test double.
		}
		return { byteSize: input.byteSize, contentSha256: input.contentSha256 };
	}

	async getObject(): Promise<Uint8Array> {
		return new Uint8Array();
	}

	async getObjectIfExists(): Promise<Uint8Array | null> {
		return null;
	}

	async putObject(): Promise<{ byteSize: number; contentSha256: string }> {
		return { byteSize: 0, contentSha256: "a" };
	}
}

function runnerInput(overrides: Partial<NoticeRunnerInput> = {}): NoticeRunnerInput {
	return {
		apiContext,
		fetchNoticeDetail: async ({ noticeId }) => detail(noticeId, "2026-08-10 09:00"),
		fetchNoticeMetadata: async () => metadata(),
		fetchNoticePage: async () => page([], 0),
		inventoryStore: new MemoryInventoryStore(),
		metaStore: new MemoryMetaStore(),
		now: () => now,
		objectStore: new MemoryObjectStore(),
		portalHost: "portal.example.edu",
		sourceStore: new MemorySourceStore(),
		stateStore: new MemoryStateStore(),
		...overrides,
	};
}

function page(items: NoticeItem[], totalItems: number): NoticeListResponse {
	return {
		datas: {
			page: { pageSize: 20, total: totalItems, totalCounts: Math.ceil(totalItems / 20) },
			tables: items,
		},
		state: true,
	};
}

function notice(noticeId: number, noticeType: number, releaseTime: string): NoticeItem {
	return {
		notice_id: noticeId,
		notice_link: null,
		notice_release_time: releaseTime,
		notice_type: noticeType,
		organization_id: "00007",
		organization_name: "党委保卫部、保卫处",
	};
}

function metadata(): NoticeMetadataResponse {
	return {
		datas: {
			org: [{ organization_id: "00007", organization_name: "党委保卫部、保卫处" }],
			type: [{ notice_type_id: 5, notice_type_name: "办公通知" }],
		},
		state: true,
	};
}

function detail(noticeId: number, releaseTime: string): NoticeDetailResponse {
	return {
		datas: {
			notice_info: {
				notice_content: `<p>${noticeId}</p>`,
				notice_id: noticeId,
				notice_release_time: releaseTime,
				notice_title: `通知 ${noticeId}`,
			},
		},
		state: true,
	};
}

function state(
	overrides: Partial<InternalPortalNoticeSyncState> = {},
): InternalPortalNoticeSyncState {
	return {
		coveredFrom: null,
		coveredUntil: null,
		updatedAt: "2026-08-25T00:00:00.000Z",
		...overrides,
	};
}
