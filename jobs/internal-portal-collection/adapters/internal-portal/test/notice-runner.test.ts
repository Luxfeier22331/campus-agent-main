import { createHash } from "node:crypto";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import { createNoticeInventoryStore } from "../src/notice-inventory-store.js";
import { buildInternalPortalNoticeSource, createInternalPortalNoticeSourceStore } from "../src/notice-source.js";
import type { Pool } from "pg";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import { PortalSessionExpiredError } from "@campus-agent/internal-portal-client";
import type { InternalPortalNoticeMetaStore } from "../src/notice-meta-store.js";
import { NoticeIngestionDataError, PortalNoticeUnavailableError } from "../src/notice-ingestion-errors.js";
import type {
	NoticeCandidateRecord,
	NoticeInventoryMappings,
	NoticeInventoryStore,
} from "../src/notice-inventory-store.js";
import {
	backfillInternalPortalNotices,
	parseNoticeStartDate,
	rescanInternalPortalNotices,
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
	ApiResponseLike,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
	NoticeMetadataResponse,
} from "../src/types.js";

const apiContext = {} as ApiRequestContextLike;
const now = "2026-08-26T02:30:07.000Z";

describe("notice runner maintenance ranges", () => {
	it.each(["sync", "backfill"] as const)(
		"ignores old pinned ordering during %s discovery",
		async (mode) => {
			const pinned = { ...notice(1, 5, "2026-08-10 09:00"), notice_stick: 1 };
			const latest = notice(2, 5, "2026-08-26 09:00");
			const sourceStore = new MemorySourceStore();
			const input = runnerInput({
				stateStore: new MemoryStateStore(
					mode === "sync"
						? state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-11" })
						: undefined,
				),
				sourceStore,
				fetchNoticePage: async () => page([pinned, latest], 2),
				fetchNoticeDetail: async ({ noticeId }) =>
					detail(noticeId, noticeId === 1 ? "2026-08-10 09:00" : "2026-08-26 09:00"),
			});
			const result =
				mode === "sync"
					? await syncInternalPortalNotices(input)
					: await backfillInternalPortalNotices({ ...input, startDate: "2026-08-01" });
			expect(result.processedRange?.to).toBe("2026-08-27");
			expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([1, 2]);
		},
	);

	it.each([false, true])(
		"discovers beyond a full pinned page (all pinned: %s)",
		async (allPinned) => {
			const old = Array.from({ length: 20 }, (_, i) => ({
				...notice(i + 1, 5, "2026-08-10 09:00"),
				notice_stick: "1",
			}));
			const latest = { ...notice(21, 5, "2026-08-26 09:00"), notice_stick: allPinned ? "1" : "0" };
			const fetchNoticePage = vi.fn(
				async ({ startDate, currentPage }: { startDate: string; currentPage: number }) =>
					startDate === "" ? page(currentPage === 1 ? old : [latest], 21) : page([latest], 1),
			);
			const result = await syncInternalPortalNotices(
				runnerInput({
					stateStore: new MemoryStateStore(
						state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-11" }),
					),
					fetchNoticePage,
					fetchNoticeDetail: async ({ noticeId }) => detail(noticeId, "2026-08-26 09:00"),
				}),
			);
			expect(result.processedRange?.to).toBe("2026-08-27");
			expect(result.pagesFetched).toBe(3);
			expect(fetchNoticePage.mock.calls).toHaveLength(3);
		},
	);

	it("includes newer pinned dates and resolves missing list dates from details", async () => {
		const result = await syncInternalPortalNotices(
			runnerInput({
				stateStore: new MemoryStateStore(
					state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-11" }),
				),
				fetchNoticePage: async ({ startDate }) =>
					startDate === ""
						? page([{ ...notice(1, 5, ""), notice_stick: 1 }, notice(2, 5, "2026-08-25 09:00")], 2)
						: page([], 0),
				fetchNoticeDetail: async ({ noticeId }) => detail(noticeId, "2026-08-26 09:00"),
			}),
		);
		expect(result.processedRange?.to).toBe("2026-08-27");
	});

	it.each([undefined, null, 2, "bad"])(
		"does not advance state for invalid pinned flag %s",
		async (notice_stick) => {
			const stateStore = new MemoryStateStore(
				state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-11" }),
			);
			const item = notice(1, 5, "2026-08-26 09:00");
			if (notice_stick === undefined) {
				delete item.notice_stick;
			} else {
				item.notice_stick = notice_stick;
			}
			await expect(
				syncInternalPortalNotices(
					runnerInput({ stateStore, fetchNoticePage: async () => page([item], 1) }),
				),
			).rejects.toThrow("notice_stick");
			expect(stateStore.saveCalls).toBe(0);
		},
	);

	it("keeps the empty portal bound in Beijing time", async () => {
		const result = await syncInternalPortalNotices(
			runnerInput({
				now: () => "2026-08-26T17:00:00Z",
				stateStore: new MemoryStateStore(
					state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-11" }),
				),
			}),
		);
		expect(result.processedRange?.to).toBe("2026-08-28");
	});

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
		expect(result.processedRange).toEqual({ from: "2025-12-01", to: "2026-08-27" });
		expect(result.maintenanceRange).toEqual({ from: "2025-12-01", to: "2026-08-27" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2025-12-01", coveredUntil: "2026-08-27", updatedAt: now }),
		);
	});

	it("rescans the final covered day and advances the exclusive upper bound", async () => {
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
			{ apiContext, currentPage: 1, endDate: "2026-08-11", startDate: "2026-08-09" },
		]);
		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([101, 102]);
		expect(result.processedRange).toEqual({ from: "2026-08-09", to: "2026-08-12" });
		expect(result.maintenanceRange).toEqual({ from: "2026-08-01", to: "2026-08-12" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-12", updatedAt: now }),
		);
	});

	it("reports an up-to-date sync with its maintained range and final progress", async () => {
		const current = state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-27" });
		const progress: unknown[] = [];
		const sourceStore = new MemorySourceStore();

		const input = runnerInput({
			fetchNoticePage: async () => page([notice(300, 5, "2026-08-26 09:00")], 1),
			fetchNoticeDetail: async ({ noticeId }) => detail(noticeId, "2026-08-26 09:00"),
			onProgress: (value) => progress.push(value), sourceStore,
			stateStore: new MemoryStateStore(current),
		});
		await syncInternalPortalNotices(input);
		const result = await syncInternalPortalNotices(input);

		expect(result).toMatchObject({
			maintenanceRange: { from: "2026-08-01", to: "2026-08-27" },
			pagesFetched: 2,
			noticesAdded: 0,
			processedRange: { from: "2026-08-26", to: "2026-08-27" },
			upToDate: true,
		});
		expect(progress.at(-1)).toMatchObject({ phase: "finalizing", processed: 1 });
		expect(sourceStore.sources).toHaveLength(2);
	});

	it("collects an afternoon notice and reviews the morning source", async () => {
		const stateStore = new MemoryStateStore(state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-26" }));
		let ids = [301];
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) => detail(noticeId, "2026-08-26 09:00"));
		const input = runnerInput({ stateStore, fetchNoticeDetail, fetchNoticePage: async () => page(ids.map(id => notice(id, 5, "2026-08-26 09:00")), ids.length) });
		expect((await syncInternalPortalNotices(input)).noticesAdded).toBe(1);
		ids = [302, 301];
		expect((await syncInternalPortalNotices(input)).noticesAdded).toBe(1);
		expect(fetchNoticeDetail.mock.calls.map(([call]) => call.noticeId)).toEqual([301, 302]);
		expect((await stateStore.load())?.coveredUntil).toBe("2026-08-27");
	});

	it("rescans a covered interval idempotently without changing its state", async () => {
		const current = state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-27" });
		const stateStore = new MemoryStateStore(current);
		const input = { ...runnerInput({ stateStore, fetchNoticePage: async () => page([notice(101, 5, "2026-08-10 09:00")], 1) }), from: "2026-08-10", to: "2026-08-11" };
		expect((await rescanInternalPortalNotices(input)).noticesAdded).toBe(1);
		expect((await rescanInternalPortalNotices(input)).noticesAdded).toBe(0);
		expect(await stateStore.load()).toEqual(current);
		expect(stateStore.saveCalls).toBe(0);
		await expect(rescanInternalPortalNotices({ ...input, to: "2026-08-28" })).rejects.toThrow("inside the maintained range");
		await expect(rescanInternalPortalNotices({ ...input, to: input.from })).rejects.toThrow("nonempty");
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

		expect(result.processedRange).toEqual({ from: "2026-08-01", to: "2026-08-10" });
		expect(result.maintenanceRange).toEqual({ from: "2026-08-01", to: "2026-08-27" });
		expect(result.state).toEqual(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-27", updatedAt: now }),
		);
	});

	it("enforces the half-open boundary using the detail release date", async () => {
		const sourceStore = new MemorySourceStore();
		const fetchNoticePage = vi.fn(async ({ startDate }: { startDate: string }) =>
			startDate === ""
				? page([notice(3, 5, "2026-08-10 00:01")], 1)
				: page([notice(1, 5, "2026-08-10 00:01"), notice(2, 5, "2026-08-11 00:01")], 2),
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

	it("continues after one resource transfer failure and advances state only after a clean rerun", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const sourceStore = new MemorySourceStore();
		const objectStore = new MemoryObjectStore();
		const inventoryStore = new MemoryInventoryStore();
		const requested: string[] = [];
		let failNoticeTwo = true;
		const apiContextWithResources: ApiRequestContextLike = {
			async get(path) {
				requested.push(path);
				const noticeId = new URL(path, "https://portal.example.edu").searchParams.get("notice_id");
				return attachmentResponse(
					noticeId === "2" && failNoticeTwo
						? interruptedBytes()
						: bytes(`attachment-${noticeId}`),
				);
			},
			async post() {
				throw new Error("unexpected post");
			},
		};
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
							notice(3, 5, "2026-08-10 11:00"),
						],
						3,
					),
		);
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
			noticeId === 3
				? detail(noticeId, "2026-08-10 11:00")
				: detailWithAttachment(noticeId, `2026-08-10 ${noticeId === 1 ? "09:00" : "10:00"}`),
		);
		const input = runnerInput({
			apiContext: apiContextWithResources,
			fetchNoticeDetail,
			fetchNoticePage,
			inventoryStore,
			objectStore,
			sourceStore,
			stateStore,
		});

		const failed = await syncInternalPortalNotices(input);

		expect(failed).toMatchObject({
			maintenanceRange: null,
			noticesProcessed: 2,
			processedRange: { from: "2026-08-09", to: "2026-08-12" },
		});
		expect(failed.failures).toHaveLength(1);
		expect(failed.failures[0]).toMatchObject({
			error: expect.stringContaining("Caused by: TypeError: terminated"),
			noticeId: 2,
			operation: "download",
			resourceKind: "attachments",
			resourceOrdinal: 0,
		});
		expect(inventoryStore.registered).toEqual([1, 3]);
		expect(sourceStore.sources.map((source) => source.notice_id)).toEqual([1, 3]);
		expect(stateStore.saveCalls).toBe(0);
		expect(objectStore.streamWrites).toEqual([
			expect.stringMatching(/^internal_portal\/resources\/sha256\/[a-f0-9]{64}$/),
		]);

		failNoticeTwo = false;
		requested.length = 0;
		const succeeded = await syncInternalPortalNotices(input);

		expect(succeeded.failures).toEqual([]);
		expect(succeeded.maintenanceRange).toEqual({ from: "2026-08-01", to: "2026-08-12" });
		expect(stateStore.saveCalls).toBe(1);
		expect(requested).toEqual([
			"/comsys-portal-notice-web/download?id=attachment-2&notice_id=2",
		]);
		expect(objectStore.streamWrites).toHaveLength(2);
		expect(objectStore.streamWrites[0]).toMatch(/^internal_portal\/resources\/sha256\/[a-f0-9]{64}$/);
		expect(objectStore.streamWrites[1]).toMatch(/^internal_portal\/resources\/sha256\/[a-f0-9]{64}$/);
	});

	it("isolates a notice whose detail is missing notice_info and keeps processing later notices", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new MemoryInventoryStore();
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) => {
			if (noticeId === 2) {
				const broken = detail(noticeId, "2026-08-10 10:00");
				if (!broken.datas) {
					throw new Error("test detail is missing datas");
				}
				broken.datas.notice_info = null;
				return broken;
			}
			return detail(noticeId, `2026-08-10 ${noticeId === 1 ? "09:00" : "11:00"}`);
		});
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
							notice(3, 5, "2026-08-10 11:00"),
						],
						3,
					),
		);

		const failed = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticeDetail,
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(failed.failures).toHaveLength(1);
		expect(failed.failures[0]).toMatchObject({
			noticeId: 2,
			operation: "detail",
		});
		expect(failed.failures[0]?.error).toContain("detail is missing notice_info");
		expect(failed.noticesProcessed).toBe(2);
		expect(inventoryStore.registered).toEqual([1, 3]);
		expect(failed.maintenanceRange).toBeNull();
		expect(stateStore.saveCalls).toBe(0);

		fetchNoticeDetail.mockImplementation(async ({ noticeId }: { noticeId: number }) =>
			detail(noticeId, `2026-08-10 ${noticeId === 1 ? "09:00" : "10:00"}`),
		);
		const succeeded = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticeDetail,
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(succeeded.failures).toEqual([]);
		expect(succeeded.maintenanceRange).toEqual({ from: "2026-08-01", to: "2026-08-12" });
		expect(stateStore.saveCalls).toBe(1);
	});

	it("isolates a notice whose source construction fails and keeps processing later notices", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new MemoryInventoryStore();
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
			noticeId === 2
				? detailWithoutTitle(noticeId, "2026-08-10 10:00")
				: detail(noticeId, `2026-08-10 ${noticeId === 1 ? "09:00" : "11:00"}`),
		);
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
							notice(3, 5, "2026-08-10 11:00"),
						],
						3,
					),
		);

		const failed = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticeDetail,
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(failed.failures).toHaveLength(1);
		expect(failed.failures[0]).toMatchObject({
			noticeId: 2,
			operation: "source",
		});
		expect(failed.failures[0]?.error).toContain("source construction failed");
		expect(failed.failures[0]?.error).toContain("notice_title");
		expect(failed.noticesProcessed).toBe(2);
		expect(inventoryStore.registered).toEqual([1, 3]);
		expect(stateStore.saveCalls).toBe(0);
	});

	it("isolates a notice whose inventory registration reports conflicting data", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new ConflictingInventoryStore();
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
							notice(3, 5, "2026-08-10 11:00"),
						],
						3,
					),
		);

		const failed = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(failed.failures).toHaveLength(1);
		expect(failed.failures[0]).toMatchObject({
			noticeId: 2,
			operation: "inventory",
		});
		expect(failed.failures[0]?.error).toContain("registered notice conflicts with source: 2");
		expect(failed.noticesProcessed).toBe(2);
		expect(stateStore.saveCalls).toBe(0);
	});

	it("stops the batch when notice detail authentication fails", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
						],
						2,
					),
		);

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticeDetail: async ({ noticeId }: { noticeId: number }) => {
						if (noticeId === 1) {
							throw new PortalSessionExpiredError("session invalid");
						}
						return detail(noticeId, "2026-08-10 10:00");
					},
					fetchNoticePage,
					stateStore,
				}),
			),
		).rejects.toThrow("session invalid");
		expect(stateStore.saveCalls).toBe(0);
	});

	it("isolates an item with an invalid notice_type and blocks state until a clean rerun", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new MemoryInventoryStore();
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							{ ...notice(2, 0, "2026-08-10 10:00"), notice_type: 0 },
							notice(3, 5, "2026-08-10 11:00"),
						],
						3,
					),
		);

		const failed = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(failed.failures).toHaveLength(1);
		expect(failed.failures[0]).toMatchObject({
			noticeId: 2,
			operation: "item",
		});
		expect(failed.failures[0]?.error).toContain("invalid notice_type");
		expect(failed.noticesProcessed).toBe(2);
		expect(inventoryStore.registered).toEqual([1, 3]);
		expect(failed.maintenanceRange).toBeNull();
		expect(stateStore.saveCalls).toBe(0);

		fetchNoticePage.mockImplementation(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
							notice(3, 5, "2026-08-10 11:00"),
						],
						3,
					),
		);
		const succeeded = await syncInternalPortalNotices(
			runnerInput({
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(succeeded.failures).toEqual([]);
		expect(succeeded.maintenanceRange).toEqual({ from: "2026-08-01", to: "2026-08-12" });
		expect(stateStore.saveCalls).toBe(1);
	});

	it("stops the scan when an item has an invalid notice_id", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							{ ...notice(2, 5, "2026-08-10 10:00"), notice_id: "abc" },
						],
						2,
					),
		);

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticePage,
					stateStore,
				}),
			),
		).rejects.toThrow("invalid notice_id");
		expect(stateStore.saveCalls).toBe(0);
	});

	it("stops the scan when pagination metadata is inconsistent", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const brokenPage: NoticeListResponse = {
			datas: { page: { pageSize: 20, total: 41, totalCounts: 2 }, tables: [] },
			state: true,
		};

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticePage: async (input: { startDate: string }) =>
						input.startDate === "" ? page([notice(300, 5, "2026-08-11 09:00")], 1) : brokenPage,
					stateStore,
				}),
			),
		).rejects.toThrow("invalid pagination metadata");
		expect(stateStore.saveCalls).toBe(0);
	});

	it("skips malformed organization metadata with diagnostics and still advances state", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const metaStore = new MemoryMetaStore();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		let result!: Awaited<ReturnType<typeof syncInternalPortalNotices>>;
		let metadataDiagnostics: unknown[] = [];
		try {
			result = await syncInternalPortalNotices(
				runnerInput({
					fetchNoticeMetadata: async () => ({
						datas: {
							org: [
								{ organization_id: null, organization_name: "无编号部门" },
								{ organization_id: "00007", organization_name: "党委保卫部、保卫处" },
								{ organization_id: "00007", organization_name: "冲突部门" },
								{ organization_id: "00008", organization_name: null },
							],
							type: [{ notice_type_id: 5, notice_type_name: "办公通知" }],
						},
						state: true,
					}),
					fetchNoticePage: async (input: { startDate: string }) =>
						input.startDate === ""
							? page([notice(300, 5, "2026-08-11 09:00")], 1)
							: page([], 0),
					metaStore,
					stateStore,
				}),
			);
			metadataDiagnostics = log.mock.calls
				.map(([value]) => JSON.parse(String(value)))
				.filter((value) => value.noticeMetadata);
		} finally {
			log.mockRestore();
		}

		expect(result.failures).toEqual([]);
		expect(result.maintenanceRange).toEqual({ from: "2026-08-01", to: "2026-08-12" });
		expect(stateStore.saveCalls).toBe(1);
		expect(metadataDiagnostics).toEqual([
			{ noticeMetadata: { organizationId: null, reason: "invalid_entry" }, status: "running" },
			{ noticeMetadata: { organizationId: "00007", reason: "duplicate_id" }, status: "running" },
			{ noticeMetadata: { organizationId: "00008", reason: "invalid_entry" }, status: "running" },
		]);
		expect(metaStore.mappingsSaved).toHaveLength(1);
		expect(metaStore.mappingsSaved[0]?.organizations).toEqual({
			"00007": "党委保卫部、保卫处",
		});
	});

	it.each([
		{
			metadata: () => ({
				datas: {
					type: [
						{ notice_type_id: 5, notice_type_name: "办公通知" },
						{ notice_type_id: 5, notice_type_name: "重复通知" },
					],
				},
				state: true,
			}),
			name: "duplicate notice type ids",
		},
		{
			metadata: () => ({ datas: { type: [] }, state: true }),
			name: "no notice types",
		},
		{
			metadata: () => ({
				datas: { type: [{ notice_type_id: 5, notice_type_name: null }] },
				state: true,
			}),
			name: "invalid notice type name",
		},
	])("stops the batch when notice type metadata has $name", async ({ metadata }) => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);

		await expect(
			syncInternalPortalNotices(
				runnerInput({
					fetchNoticeMetadata: async () => metadata(),
					fetchNoticePage: async (input: { startDate: string }) =>
						input.startDate === "" ? page([notice(300, 5, "2026-08-11 09:00")], 1) : page([], 0),
					stateStore,
				}),
			),
		).rejects.toThrow();
		expect(stateStore.saveCalls).toBe(0);
	});

	it("registers a notice and advances state when one declared attachment returns HTTP 404", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new MemoryInventoryStore();
		const objectStore = new MemoryObjectStore();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		let result!: Awaited<ReturnType<typeof syncInternalPortalNotices>>;
		let missingResourceLog: unknown;
		try {
			result = await syncInternalPortalNotices(
				runnerInput({
					apiContext: {
						get: async (path) =>
							path.includes("id=attachment-1-0")
								? httpErrorResponse(404, "Not Found")
								: attachmentResponse(bytes("present attachment")),
						post: async () => {
							throw new Error("unexpected post");
						},
					},
					fetchNoticeDetail: async () => detailWithTwoAttachments(1, "2026-08-10 09:00"),
					fetchNoticePage: async (input) =>
						input.startDate === ""
							? page([notice(300, 5, "2026-08-11 09:00")], 1)
							: page([notice(1, 5, "2026-08-10 09:00")], 1),
					inventoryStore,
					objectStore,
					onProgress: () => undefined,
					stateStore,
				}),
			);
			missingResourceLog = log.mock.calls
				.map(([value]) => JSON.parse(String(value)))
				.find((value) => value.noticeResource);
		} finally {
			log.mockRestore();
		}

		expect(result).toMatchObject({
			failures: [],
			maintenanceRange: { from: "2026-08-01", to: "2026-08-12" },
			noticesProcessed: 1,
			resources: {
				attachmentsDownloaded: 1,
				attachmentsMissing: 1,
				attachmentsReused: 0,
			},
		});
		expect(inventoryStore.registered).toEqual([1]);
		expect(objectStore.streamWrites).toEqual([expect.stringMatching(/^internal_portal\/resources\/sha256\/[a-f0-9]{64}$/)]);
		expect(stateStore.saveCalls).toBe(1);
		expect(missingResourceLog).toEqual({
			noticeResource: {
				disposition: "missing",
				httpStatus: 404,
				noticeId: 1,
				resourceKind: "attachments",
				resourceOrdinal: 0,
			},
			status: "running",
		});
	});

	it.each([
		{
			expectedError: "HTTP 500 Server Error",
			get: async () => httpErrorResponse(500, "Server Error"),
			name: "HTTP 500",
		},
		{
			expectedError: "TimeoutError: request timed out",
			get: async () => {
				throw Object.assign(new Error("request timed out"), { name: "TimeoutError" });
			},
			name: "timeout",
		},
	])("keeps attachment $name as a resource failure", async ({ expectedError, get }) => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const result = await syncInternalPortalNotices(
			runnerInput({
				apiContext: {
					get,
					post: async () => {
						throw new Error("unexpected post");
					},
				},
				fetchNoticeDetail: async () => detailWithAttachment(1, "2026-08-10 09:00"),
				fetchNoticePage: async (input) =>
					input.startDate === ""
						? page([notice(300, 5, "2026-08-11 09:00")], 1)
						: page([notice(1, 5, "2026-08-10 09:00")], 1),
				onProgress: () => undefined,
				stateStore,
			}),
		);

		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]?.error).toContain(expectedError);
		expect(result.resources.attachmentsMissing).toBe(0);
		expect(stateStore.saveCalls).toBe(0);
	});

	it("keeps inline image HTTP 404 as a resource failure", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const result = await syncInternalPortalNotices(
			runnerInput({
				apiContext: {
					get: async () => httpErrorResponse(404, "Not Found"),
					post: async () => {
						throw new Error("unexpected post");
					},
				},
				fetchNoticeDetail: async () => detailWithImage(1, "2026-08-10 09:00"),
				fetchNoticePage: async (input) =>
					input.startDate === ""
						? page([notice(300, 5, "2026-08-11 09:00")], 1)
						: page([notice(1, 5, "2026-08-10 09:00")], 1),
				onProgress: () => undefined,
				stateStore,
			}),
		);

		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			noticeId: 1,
			resourceKind: "images",
			resourceOrdinal: 0,
		});
		expect(result.resources.attachmentsMissing).toBe(0);
		expect(stateStore.saveCalls).toBe(0);
	});

	it("isolates an interrupted inline image and continues with later notices", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new MemoryInventoryStore();
		const apiContextWithInterruptedImage: ApiRequestContextLike = {
			async get() {
				return attachmentResponse(interruptedBytes());
			},
			async post() {
				throw new Error("unexpected post");
			},
		};
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[
							notice(1, 5, "2026-08-10 09:00"),
							notice(2, 5, "2026-08-10 10:00"),
						],
						2,
					),
		);
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
			noticeId === 1
				? detailWithImage(noticeId, "2026-08-10 09:00")
				: detail(noticeId, "2026-08-10 10:00"),
		);

		const result = await syncInternalPortalNotices(
			runnerInput({
				apiContext: apiContextWithInterruptedImage,
				fetchNoticeDetail,
				fetchNoticePage,
				inventoryStore,
				stateStore,
			}),
		);

		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			error: expect.stringContaining("Caused by: TypeError: terminated"),
			noticeId: 1,
			operation: "download",
			resourceKind: "images",
			resourceOrdinal: 0,
		});
		expect(inventoryStore.registered).toEqual([2]);
		expect(stateStore.saveCalls).toBe(0);
	});

	it("marks portal-confirmed deletions as unavailable without blocking the covered range", async () => {
		const stateStore = new MemoryStateStore(
			state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-10" }),
		);
		const inventoryStore = new MemoryInventoryStore();
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[notice(1, 5, "2026-08-10 09:00"), notice(2, 5, "2026-08-10 10:00")],
						2,
					),
		);
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) => {
			if (noticeId === 2) {
				throw new PortalNoticeUnavailableError({
					message: "notice 2 is unavailable on the portal: 通知公告已删除",
					noticeId,
				});
			}
			return detail(noticeId, "2026-08-10 09:00");
		});

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticeDetail, fetchNoticePage, inventoryStore, stateStore }),
		);

		expect(result.failures).toEqual([]);
		expect(inventoryStore.unavailable).toEqual([2]);
		expect(inventoryStore.registered).toEqual([1]);
		expect(result.state?.coveredUntil).toBe("2026-08-12");
		expect(result.state?.unavailableNoticeIds).toEqual([2]);
	});

	it("skips the detail probe for notices already recorded as unavailable", async () => {
		const stateStore = new MemoryStateStore(
			state({
				coveredFrom: "2026-08-01",
				coveredUntil: "2026-08-10",
				unavailableNoticeIds: [2],
			}),
		);
		const inventoryStore = new MemoryInventoryStore();
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-11 09:00")], 1)
				: page(
						[notice(1, 5, "2026-08-10 09:00"), notice(2, 5, "2026-08-10 10:00")],
						2,
					),
		);
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
			detail(noticeId, "2026-08-10 09:00"),
		);

		const result = await syncInternalPortalNotices(
			runnerInput({ fetchNoticeDetail, fetchNoticePage, inventoryStore, stateStore }),
		);

		expect(fetchNoticeDetail).toHaveBeenCalledTimes(1);
		expect(fetchNoticeDetail).toHaveBeenCalledWith(
			expect.objectContaining({ noticeId: 1 }),
		);
		expect(inventoryStore.unavailable).toEqual([]);
		expect(result.state?.unavailableNoticeIds).toEqual([2]);
	});

	it("recovers an unavailable notice when a periodic review fetches it again", async () => {
		const stateStore = new MemoryStateStore(
			state({
				coveredFrom: "2026-08-01",
				coveredUntil: "2026-08-10",
				recentReviewedAt: "2026-08-24T00:00:00.000Z",
				fullReviewedAt: "2026-08-18T00:00:00.000Z",
				unavailableNoticeIds: [2],
			}),
		);
		const inventoryStore = new MemoryInventoryStore();
		inventoryStore.listExisting = async () => [
			{ notice_id: 2, notice_type: 5, organization_id: "00007" },
		];
		const fetchNoticePage = vi.fn(async (input: { startDate: string }) =>
			input.startDate === ""
				? page([notice(300, 5, "2026-08-27 09:00")], 1)
				: page([notice(1, 5, "2026-08-26 09:00")], 1),
		);
		const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
			detail(noticeId, "2026-08-26 09:00"),
		);

		const result = await syncInternalPortalNotices({
			...runnerInput({ fetchNoticeDetail, fetchNoticePage, inventoryStore, stateStore }),
			enablePeriodicReview: true,
		});

		expect(inventoryStore.registered).toContain(2);
		expect(result.state?.unavailableNoticeIds).toBeUndefined();
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

		expect(result).toMatchObject({
			maintenanceRange: { from: "2026-01-01", to: "2026-08-27" },
			pagesFetched: 0,
			processedRange: null,
			state: current,
		});
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

		expect(result.processedRange).toEqual({ from: "2026-08-10", to: "2026-08-12" });
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
				processedRange: { from: "2026-08-10", to: "2026-08-12" },
				status: "running",
			});
			expect(record.progress).not.toHaveProperty("processedRange");
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

		expect(result.processedRange).toEqual({ from: "2025-12-01", to: "2026-08-27" });
		expect(result.maintenanceRange).toEqual({ from: "2025-12-01", to: "2026-08-27" });
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
	readonly mappingsSaved: Array<{
		noticeTypes: Record<string, string>;
		organizations: Record<string, string>;
		updatedAt: string;
	}> = [];

	async putMappings(input: {
		noticeTypes: Record<string, string>;
		organizations: Record<string, string>;
		updatedAt: string;
	}): Promise<"reused" | "written"> {
		this.mappingsSaved.push(structuredClone(input));
		return "written";
	}
}

class MemoryInventoryStore implements NoticeInventoryStore {
	readonly mappings: NoticeInventoryMappings[] = [];
	readonly registered: number[] = [];
	readonly unavailable: number[] = [];
	listExisting?: (from: string, to: string) => Promise<NoticeCandidateRecord[]>;

	async getSourceRefs(): Promise<Map<number, string | null>> { return new Map(); }

	async register(source: InternalPortalNoticeSource): Promise<"written" | "reused"> {
		if (this.registered.includes(source.notice_id)) return "reused";
		this.registered.push(source.notice_id);
		return "written";
	}

	async markUnavailable(noticeId: number): Promise<void> {
		if (!this.unavailable.includes(noticeId)) this.unavailable.push(noticeId);
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

class ConflictingInventoryStore extends MemoryInventoryStore {
	override async register(source: InternalPortalNoticeSource): Promise<"written" | "reused"> {
		if (source.notice_id === 2) {
			throw new NoticeIngestionDataError({
				message: `registered notice conflicts with source: ${source.notice_id}`,
				noticeId: source.notice_id,
				operation: "inventory",
			});
		}
		return super.register(source);
	}
}

class MemoryObjectStore implements InternalPortalCollectionObjectStore {
	readonly objects = new Set<string>();
	readonly sourceBucket = "campus-agent-source";
	readonly streamWrites: string[] = [];

	async createOrVerifyObject(_input: Parameters<InternalPortalCollectionObjectStore["createOrVerifyObject"]>[0]): Promise<{ byteSize: number; contentSha256: string }> {
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
		this.objects.add(input.key);
		this.streamWrites.push(input.key);
		return { byteSize: input.byteSize, contentSha256: input.contentSha256 };
	}

	async getObject(): Promise<Uint8Array> {
		return new Uint8Array();
	}

	async hasObject(input: { key: string }): Promise<boolean> { return this.objects.has(input.key); }

	async getObjectIfExists(input: { key: string }): Promise<Uint8Array | null> {
		return this.objects.has(input.key) ? new Uint8Array([1]) : null;
	}

	async pruneObjectVersions(): Promise<void> {}

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
		notice_stick: 0,
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

function detailWithAttachment(noticeId: number, releaseTime: string): NoticeDetailResponse {
	const value = detail(noticeId, releaseTime);
	const info = value.datas?.notice_info;
	if (!info) {
		throw new Error("test detail is missing notice_info");
	}
	info.notice_annext = [
		{
			notice_annex_id: `attachment-${noticeId}`,
			notice_annex_name: `attachment-${noticeId}.pdf`,
			suffix: "pdf",
			type: "application/pdf",
		},
	];
	return value;
}

function detailWithTwoAttachments(noticeId: number, releaseTime: string): NoticeDetailResponse {
	const value = detail(noticeId, releaseTime);
	const info = value.datas?.notice_info;
	if (!info) {
		throw new Error("test detail is missing notice_info");
	}
	info.notice_annext = [0, 1].map((ordinal) => ({
		notice_annex_id: `attachment-${noticeId}-${ordinal}`,
		notice_annex_name: `attachment-${noticeId}-${ordinal}.pdf`,
		suffix: "pdf",
		type: "application/pdf",
	}));
	return value;
}

function detailWithoutTitle(noticeId: number, releaseTime: string): NoticeDetailResponse {
	const value = detail(noticeId, releaseTime);
	const info = value.datas?.notice_info;
	if (!info) {
		throw new Error("test detail is missing notice_info");
	}
	info.notice_title = null;
	return value;
}

function detailWithImage(noticeId: number, releaseTime: string): NoticeDetailResponse {
	const value = detail(noticeId, releaseTime);
	const info = value.datas?.notice_info;
	if (!info) {
		throw new Error("test detail is missing notice_info");
	}
	info.notice_content = `<p><img src="https://portal.example.edu/images/${noticeId}.png"></p>`;
	return value;
}

function attachmentResponse(body: AsyncIterable<Uint8Array>): ApiResponseLike {
	return {
		bodyStream: () => body,
		headers: () => ({ "content-type": "application/pdf" }),
		ok: () => true,
		status: () => 200,
		statusText: () => "OK",
		text: async () => "",
	};
}

function httpErrorResponse(status: number, statusText: string): ApiResponseLike {
	return {
		cancelBody: async () => undefined,
		headers: () => ({}),
		ok: () => false,
		status: () => status,
		statusText: () => statusText,
		text: async () => statusText,
	};
}

async function* bytes(value: string): AsyncGenerator<Uint8Array> {
	yield new TextEncoder().encode(value);
}

async function* interruptedBytes(): AsyncGenerator<Uint8Array> {
	yield new TextEncoder().encode("partial");
	throw new TypeError("terminated", { cause: new Error("other side closed") });
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

// Exercise the real inventory/source adapters so request counts include adapter I/O.
function ioFixture() {
	const releaseTime = "2026-08-26 09:00";
	const initialBody = Buffer.from("initial attachment");
	const digest = createHash("sha256").update(initialBody).digest("hex");
	const resourceKey = `internal_portal/resources/sha256/${digest}`;
	const sources = [1, 2].map((noticeId) => ({
		...buildInternalPortalNoticeSource({
			detailInfo: detailWithAttachment(noticeId, releaseTime).datas!.notice_info!,
			listItem: notice(noticeId, 5, releaseTime),
			noticeId,
			noticeType: 5,
		}),
		resources: [
			{
				kind: "attachments" as const,
				ordinal: 0,
				object_key: resourceKey,
				content_type: "application/pdf",
				byte_size: initialBody.length,
				sha256: digest,
			},
		],
	}));
	const refs = new Map(sources.map((source) => [source.notice_id, noticeSourceRef(source)]));
	const objects = new Map<string, Uint8Array>(
		sources.map((source) => [noticeSourceRef(source), Buffer.from(JSON.stringify(source))]),
	);
	objects.set(resourceKey, initialBody);
	const objectStore = new MemoryObjectStore();
	const get = vi
		.spyOn(objectStore, "getObjectIfExists")
		.mockImplementation(async ({ key }) => objects.get(key) ?? null);
	const head = vi
		.spyOn(objectStore, "hasObject")
		.mockImplementation(async ({ key }) => objects.has(key));
	const put = vi.fn(async (value: { key: string; body: Uint8Array }) => {
		objects.set(value.key, value.body);
		return {
			byteSize: value.body.byteLength,
			contentSha256: createHash("sha256").update(value.body).digest("hex"),
		};
	});
	objectStore.createOrVerifyObject = put;
	const stream = vi.spyOn(objectStore, "createOrVerifyStream");
	const query = vi.fn(async (sql: string, values: unknown[] = []) => {
		if (sql.startsWith("SELECT notice_id, source_ref"))
			return {
				rows: [...refs].map(([notice_id, source_ref]) => ({ notice_id, source_ref })),
				rowCount: refs.size,
			};
		if (sql.startsWith("SELECT notice_id, notice_type"))
			return {
				rows: sources.map((source) => ({
					notice_id: source.notice_id,
					notice_type: 5,
					organization_id: source.organization_id,
				})),
				rowCount: sources.length,
			};
		if (sql.startsWith("INSERT INTO notices.notices")) {
			const id = values[0] as number;
			const ref = values[7] as string;
			const exists = refs.has(id);
			const changed = refs.get(id) !== ref;
			refs.set(id, ref);
			return {
				rows: changed ? [{ notice_id: id, inserted: !exists }] : [],
				rowCount: changed ? 1 : 0,
			};
		}
		return { rows: [], rowCount: 1 };
	});
	const inventoryStore = createNoticeInventoryStore({ query } as unknown as Pick<Pool, "query">);
	const fetchNoticeDetail = vi.fn(async ({ noticeId }: { noticeId: number }) =>
		detailWithAttachment(noticeId, releaseTime),
	);
	const fetchNoticePage = vi.fn(async () =>
		page([notice(1, 5, releaseTime), notice(2, 5, releaseTime)], 2),
	);
	const download = vi.fn(async () => attachmentResponse(bytes("updated attachment")));
	const stateStore = new MemoryStateStore(
		state({ coveredFrom: "2026-08-01", coveredUntil: "2026-08-27" }),
	);
	const input = runnerInput({
		inventoryStore,
		objectStore,
		sourceStore: createInternalPortalNoticeSourceStore({ objectStore }),
		stateStore,
		fetchNoticeDetail,
		fetchNoticePage,
		apiContext: {
			get: download,
			post: async () => {
				throw new Error("unexpected POST");
			},
		},
	});
	return {
		input,
		sources,
		refs,
		objects,
		resourceKey,
		get,
		head,
		put,
		stream,
		query,
		download,
		fetchNoticeDetail,
		fetchNoticePage,
		stateStore,
	};
}

describe("notice collection I/O", () => {
	it("batch resolves refs and reads each unchanged source once, checking resources with HEAD", async () => {
		const f = ioFixture();
		const result = await syncInternalPortalNotices(f.input);
		expect(result).toMatchObject({
			noticesProcessed: 2,
			noticesUnchanged: 2,
			objectsReused: 2,
			failures: [],
		});
		expect(
			f.query.mock.calls.filter(([sql]) => sql.startsWith("SELECT notice_id, source_ref")),
		).toHaveLength(1);
		expect(
			f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO notices.notices")),
		).toHaveLength(2);
		expect(f.get).toHaveBeenCalledTimes(2);
		expect(f.head).toHaveBeenCalledTimes(2);
		expect(f.put).not.toHaveBeenCalled();
		expect(f.download).not.toHaveBeenCalled();
		expect(f.fetchNoticeDetail).not.toHaveBeenCalled();
	});

	it("merges incremental and full review candidates and detects same-URL byte changes once", async () => {
		const f = ioFixture();
		const previousRefs = [...f.refs.values()];
		const result = await syncInternalPortalNotices({ ...f.input, enablePeriodicReview: true });
		expect(result).toMatchObject({
			noticesProcessed: 2,
			noticesUpdated: 2,
			failures: [],
			resources: { attachmentsDownloaded: 2 },
		});
		expect(f.fetchNoticeDetail).toHaveBeenCalledTimes(2);
		expect(f.download).toHaveBeenCalledTimes(2);
		expect(f.stream).toHaveBeenCalledTimes(2);
		expect(f.get).toHaveBeenCalledTimes(2); // Only old sources; no discarded legacy resource GETs.
		expect(f.put).toHaveBeenCalledTimes(2);
		expect([...f.refs.values()]).not.toEqual(previousRefs);
		expect(
			f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO notices.notices")),
		).toHaveLength(2);
		expect(result.state).toMatchObject({ recentReviewedAt: now, fullReviewedAt: now });
	});

	it("reviews a database-only notice even after its release date moves outside the review range", async () => {
		const f = ioFixture();
		f.fetchNoticePage.mockResolvedValue(page([notice(1, 5, "2026-08-26 09:00")], 1));
		f.fetchNoticeDetail.mockImplementation(async ({ noticeId }) =>
			detailWithAttachment(noticeId, noticeId === 2 ? "2026-07-01 09:00" : "2026-08-26 09:00"),
		);
		const result = await syncInternalPortalNotices({ ...f.input, enablePeriodicReview: true });
		expect(result.failures).toEqual([]);
		expect(f.fetchNoticeDetail).toHaveBeenCalledTimes(2);
		const registered = f.query.mock.calls.find(
			([sql, values]) => sql.startsWith("INSERT INTO notices.notices") && values?.[0] === 2,
		)!;
		expect(registered[1]![4]).toBe("2026-07-01T01:00:00.000Z");
	});

	it.each(["scan", "detail"])(
		"does not advance state on %s failures or retry candidates within a run",
		async (failure) => {
			const f = ioFixture();
			if (failure === "detail")
				f.fetchNoticeDetail.mockImplementation(async ({ noticeId }) => {
					if (noticeId === 2) throw new Error("detail failed");
					return detailWithAttachment(noticeId, "2026-08-26 09:00");
				});
			else
				f.fetchNoticePage.mockResolvedValue(
					page(
						[
							notice(1, 5, "2026-08-26 09:00"),
							{ ...notice(2, 5, "2026-08-26 09:00"), notice_type: 0 },
						],
						2,
					),
				);
			const result = await syncInternalPortalNotices({ ...f.input, enablePeriodicReview: true });
			expect(result.failures.length).toBeGreaterThan(0);
			expect(f.stateStore.saveCalls).toBe(0);
			expect(result.state?.recentReviewedAt).toBeUndefined();
			expect(result.state?.fullReviewedAt).toBeUndefined();
			expect(f.fetchNoticeDetail.mock.calls.filter(([value]) => value.noticeId === 2)).toHaveLength(
				1,
			);
		},
	);

	it.each(["source", "resource"])("recovers missing %s objects", async (missing) => {
		const f = ioFixture();
		f.objects.delete(missing === "source" ? f.refs.get(1)! : f.resourceKey);
		const result = await syncInternalPortalNotices(f.input);
		expect(result.failures).toEqual([]);
		expect(f.download).toHaveBeenCalledTimes(missing === "source" ? 1 : 2);
		expect(f.stream).toHaveBeenCalledTimes(missing === "source" ? 1 : 2);
		expect(f.fetchNoticeDetail).toHaveBeenCalledTimes(missing === "source" ? 1 : 0);
		expect(f.put).toHaveBeenCalledTimes(missing === "source" ? 1 : 2);
	});

	it("materializes a legacy source into a snapshot even when its content is unchanged", async () => {
		const f = ioFixture();
		const source = f.sources[0]!;
		f.refs.delete(1);
		f.objects.delete(noticeSourceRef(source));
		f.objects.set(`internal_portal/notices/1.json`, Buffer.from(JSON.stringify(source)));
		const result = await syncInternalPortalNotices(f.input);
		expect(result.failures).toEqual([]);
		expect(f.put).toHaveBeenCalledTimes(1);
		expect(f.objects.has(noticeSourceRef(source))).toBe(true);
		expect(f.download).not.toHaveBeenCalled();
	});

	it("migrates legacy resource bytes instead of redownloading them", async () => {
		const f = ioFixture();
		for (const original of f.sources) {
			const { resources: _resources, ...source } = original;
			const ref = noticeSourceRef(source);
			f.refs.set(source.notice_id, ref);
			f.objects.set(ref, Buffer.from(JSON.stringify(source)));
			f.objects.set(
				`internal_portal/notices/${source.notice_id}/attachments/0`,
				f.objects.get(f.resourceKey)!,
			);
		}
		const result = await syncInternalPortalNotices(f.input);
		expect(result).toMatchObject({
			failures: [],
			noticesUpdated: 2,
			resources: { attachmentsReused: 2 },
		});
		expect(f.download).not.toHaveBeenCalled();
		for (const source of f.sources) {
			const migrated = {
				...source,
				resources: source.resources.map((ref) => ({
					...ref,
					content_type: "application/octet-stream",
				})),
			};
			expect(f.refs.get(source.notice_id)).toBe(noticeSourceRef(migrated));
		}
	});

	it("prefers review list metadata over incremental metadata", async () => {
		const f = ioFixture();
		f.fetchNoticePage
			.mockResolvedValueOnce(page([notice(1, 5, "2026-08-26 09:00")], 1))
			.mockResolvedValueOnce(
				page([{ ...notice(1, 5, "2026-08-26 09:00"), notice_link: "https://example.edu/old" }], 1),
			)
			.mockResolvedValueOnce(
				page(
					[{ ...notice(1, 5, "2026-08-26 09:00"), notice_link: "https://example.edu/current" }],
					1,
				),
			);
		const result = await syncInternalPortalNotices({ ...f.input, enablePeriodicReview: true });
		expect(result.failures).toEqual([]);
		const registered = f.query.mock.calls.find(
			([sql, values]) => sql.startsWith("INSERT INTO notices.notices") && values?.[0] === 1,
		)!;
		expect(registered[1]![6]).toBe("https://example.edu/current");
		expect(f.fetchNoticeDetail.mock.calls.filter(([value]) => value.noticeId === 1)).toHaveLength(
			1,
		);
	});

	it("discovers silent body changes during review with unchanged list metadata", async () => {
		const f = ioFixture();
		f.fetchNoticeDetail.mockImplementation(async ({ noticeId }) => {
			const value = detailWithAttachment(noticeId, "2026-08-26 09:00");
			value.datas!.notice_info!.notice_content = "<p>edited silently</p>";
			return value;
		});
		f.download.mockImplementation(async () => attachmentResponse(bytes("initial attachment")));
		const result = await syncInternalPortalNotices({ ...f.input, enablePeriodicReview: true });
		expect(result).toMatchObject({ failures: [], noticesUpdated: 2 });
		expect(f.download).toHaveBeenCalledTimes(2);
		for (const ref of f.refs.values()) {
			expect(JSON.parse(Buffer.from(f.objects.get(ref)!).toString()).notice_content_html).toBe(
				"<p>edited silently</p>",
			);
		}
	});

	it("does not query source refs for an empty candidate set", async () => {
		const f = ioFixture();
		await expect(f.input.inventoryStore.getSourceRefs([])).resolves.toEqual(new Map());
		expect(f.query).not.toHaveBeenCalled();
	});

	it("propagates object-store HEAD failures instead of treating them as missing", async () => {
		const f = ioFixture();
		f.head.mockRejectedValue(new Error("storage unavailable"));
		await expect(syncInternalPortalNotices(f.input)).rejects.toThrow("storage unavailable");
		expect(f.download).not.toHaveBeenCalled();
		expect(f.stateStore.saveCalls).toBe(0);
	});
});
