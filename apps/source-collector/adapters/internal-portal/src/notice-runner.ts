import {
	buildInternalPortalNoticeSource,
	type InternalPortalNoticeSourceStore,
} from "./notice-source.js";
import type {
	InternalPortalNoticeSyncState,
	InternalPortalNoticeSyncStateStore,
} from "./notice-state-store.js";
import type {
	ApiRequestContextLike,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
} from "./types.js";

const NOTICE_TYPE = "5";
const NOTICE_PAGE_SIZE = 20;

export interface NoticeRunnerInput {
	apiContext: ApiRequestContextLike;
	fetchNoticeDetail: (input: {
		apiContext: ApiRequestContextLike;
		noticeId: number;
	}) => Promise<NoticeDetailResponse>;
	fetchNoticePage: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		startDate: string;
	}) => Promise<NoticeListResponse>;
	now?: () => string;
	siteId: string;
	sourceStore: InternalPortalNoticeSourceStore;
	stateStore: InternalPortalNoticeSyncStateStore;
}

export interface NoticeRunnerResult {
	mode: "backfill" | "sync";
	objectsReused: number;
	objectsWritten: number;
	pagesFetched: number;
	state: InternalPortalNoticeSyncState;
}

interface NoticeScan {
	candidateIds: number[];
	maxObservedId: number | null;
	pagesFetched: number;
}

export async function syncInternalPortalNotices(
	input: NoticeRunnerInput,
): Promise<NoticeRunnerResult> {
	const current = await input.stateStore.load(input.siteId);
	if (!current) {
		const page = await fetchPage(input, 1, "");
		parseTotalPages(page);
		const ids = parseOrderedNoticeIds(page.datas?.tables ?? []);
		const state = await saveState(
			input,
			stateWith(current, {
				incrementalHeadId: ids[0] ?? null,
				siteId: input.siteId,
			}),
		);
		return result("sync", state, 1);
	}
	if (current.incrementalHeadId === null) {
		const scan = await scanBackfillNotices(input, current, "");
		if (scan.candidateIds.length === 0) {
			return result("sync", current, scan.pagesFetched);
		}
		const objectCounts = await writeCandidates(input, scan.candidateIds);
		const state = await saveState(
			input,
			withCapturedIds(
				{
					...current,
					incrementalHeadId: scan.maxObservedId,
				},
				scan.candidateIds,
			),
		);
		return result("sync", state, scan.pagesFetched, objectCounts);
	}

	const scan = await scanIncrementalNotices(input, current.incrementalHeadId);
	if (scan.candidateIds.length === 0) {
		return result("sync", current, scan.pagesFetched);
	}

	const objectCounts = await writeCandidates(input, scan.candidateIds);
	const state = await saveState(
		input,
		withCapturedIds(
			{
				...current,
				incrementalHeadId: scan.maxObservedId ?? current.incrementalHeadId,
			},
			scan.candidateIds,
		),
	);
	return result("sync", state, scan.pagesFetched, objectCounts);
}

export async function backfillInternalPortalNotices(
	input: NoticeRunnerInput & { startDate: string },
): Promise<NoticeRunnerResult> {
	const startDate = parseNoticeStartDate(input.startDate);
	const current = await input.stateStore.load(input.siteId);
	if (current && isNoticeHistoryCovered(current, startDate)) {
		return result("backfill", current, 0);
	}

	const scan = await scanBackfillNotices(input, current, startDate);
	let pagesFetched = scan.pagesFetched;
	let incrementalHeadId = current?.incrementalHeadId ?? scan.maxObservedId;
	if (!current && incrementalHeadId === null) {
		const baselinePage = await fetchPage(input, 1, "");
		parseTotalPages(baselinePage);
		const baselineIds = parseOrderedNoticeIds(baselinePage.datas?.tables ?? []);
		incrementalHeadId = baselineIds[0] ?? null;
		pagesFetched += 1;
	}
	const objectCounts = await writeCandidates(input, scan.candidateIds);
	const state = withCapturedIds(
		stateWith(current, {
			incrementalHeadId,
			siteId: input.siteId,
		}),
		scan.candidateIds,
	);
	let updated: InternalPortalNoticeSyncState = {
		...state,
		historyCoveredFrom: earlierDate(current?.historyCoveredFrom ?? null, startDate),
	};
	if (!(current && sameState(current, updated))) {
		updated = await saveState(input, updated);
	}
	return result("backfill", updated, pagesFetched, objectCounts);
}

export function isNoticeHistoryCovered(
	state: InternalPortalNoticeSyncState | null,
	startDate: string,
): boolean {
	return state?.historyCoveredFrom !== null && state?.historyCoveredFrom !== undefined
		? state.historyCoveredFrom <= startDate
		: false;
}

export function parseNoticeStartDate(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		throw new Error("--start-date must use YYYY-MM-DD");
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
		throw new Error("--start-date must be a valid calendar date");
	}
	return value;
}

async function scanIncrementalNotices(
	input: NoticeRunnerInput,
	currentHeadId: number,
): Promise<NoticeScan> {
	const candidateIds: number[] = [];
	let foundHead = false;
	let maxObservedId: number | null = null;
	let pagesFetched = 0;
	let previousId: number | null = null;
	let totalPages: number | null = null;

	for (let currentPage = 1; totalPages === null || currentPage <= totalPages; currentPage += 1) {
		const page = await fetchPage(input, currentPage, "");
		pagesFetched += 1;
		totalPages ??= parseTotalPages(page);
		for (const item of page.datas?.tables ?? []) {
			const noticeId = parseNoticeId(item.notice_id);
			assertDescendingNoticeId(previousId, noticeId);
			previousId = noticeId;
			maxObservedId = maxObservedId ?? noticeId;
			if (noticeId === currentHeadId) {
				foundHead = true;
				break;
			}
			if (noticeId < currentHeadId) {
				throw new Error(
					`notice type ${NOTICE_TYPE} passed incremental head ${currentHeadId} before returning it`,
				);
			}
			candidateIds.push(noticeId);
		}
		if (foundHead) {
			break;
		}
	}

	if (!foundHead) {
		throw new Error(`notice type ${NOTICE_TYPE} did not return incremental head ${currentHeadId}`);
	}
	return {
		candidateIds: candidateIds.sort((left, right) => left - right),
		maxObservedId,
		pagesFetched,
	};
}

async function scanBackfillNotices(
	input: NoticeRunnerInput,
	current: InternalPortalNoticeSyncState | null,
	startDate: string,
): Promise<NoticeScan> {
	const candidateIds: number[] = [];
	let maxObservedId: number | null = null;
	let pagesFetched = 0;
	let previousId: number | null = null;
	let totalPages: number | null = null;

	for (let currentPage = 1; totalPages === null || currentPage <= totalPages; currentPage += 1) {
		const page = await fetchPage(input, currentPage, startDate);
		pagesFetched += 1;
		totalPages ??= parseTotalPages(page);
		for (const item of page.datas?.tables ?? []) {
			const noticeId = parseNoticeId(item.notice_id);
			assertDescendingNoticeId(previousId, noticeId);
			previousId = noticeId;
			maxObservedId = maxObservedId ?? noticeId;
			if (
				current?.minCapturedId !== null && current?.minCapturedId !== undefined
					? noticeId < current.minCapturedId
					: current?.incrementalHeadId !== null && current?.incrementalHeadId !== undefined
						? noticeId <= current.incrementalHeadId
						: true
			) {
				candidateIds.push(noticeId);
			}
		}
	}

	return {
		candidateIds: candidateIds.sort((left, right) => left - right),
		maxObservedId,
		pagesFetched,
	};
}

function parseOrderedNoticeIds(items: NoticeItem[]): number[] {
	const ids: number[] = [];
	let previousId: number | null = null;
	for (const item of items) {
		const noticeId = parseNoticeId(item.notice_id);
		assertDescendingNoticeId(previousId, noticeId);
		previousId = noticeId;
		ids.push(noticeId);
	}
	return ids;
}

function assertDescendingNoticeId(previousId: number | null, noticeId: number): void {
	if (previousId !== null && noticeId >= previousId) {
		throw new Error(`notice type ${NOTICE_TYPE} returned notice ids out of descending order`);
	}
}

async function fetchPage(
	input: NoticeRunnerInput,
	currentPage: number,
	startDate: string,
): Promise<NoticeListResponse> {
	return await input.fetchNoticePage({
		apiContext: input.apiContext,
		currentPage,
		startDate,
	});
}

async function writeCandidates(
	input: NoticeRunnerInput,
	candidateIds: number[],
): Promise<{ objectsReused: number; objectsWritten: number }> {
	let objectsReused = 0;
	let objectsWritten = 0;
	for (const noticeId of candidateIds) {
		const detail = await input.fetchNoticeDetail({
			apiContext: input.apiContext,
			noticeId,
		});
		const detailInfo = detail.datas?.notice_info;
		if (!detailInfo) {
			throw new Error(`notice ${noticeId} detail is missing notice_info`);
		}
		const source = buildInternalPortalNoticeSource({
			detailInfo,
			noticeId,
			siteId: input.siteId,
		});
		const outcome = await input.sourceStore.put(source);
		if (outcome === "reused") {
			objectsReused += 1;
		} else {
			objectsWritten += 1;
		}
	}
	return { objectsReused, objectsWritten };
}

async function saveState(
	input: NoticeRunnerInput,
	state: InternalPortalNoticeSyncState,
): Promise<InternalPortalNoticeSyncState> {
	const updated = {
		...state,
		updatedAt: (input.now ?? (() => new Date().toISOString()))(),
	};
	await input.stateStore.save(updated);
	return updated;
}

function stateWith(
	current: InternalPortalNoticeSyncState | null,
	identity: { incrementalHeadId: number | null; siteId: string },
): InternalPortalNoticeSyncState {
	return {
		historyCoveredFrom: current?.historyCoveredFrom ?? null,
		incrementalHeadId: identity.incrementalHeadId,
		maxCapturedId: current?.maxCapturedId ?? null,
		minCapturedId: current?.minCapturedId ?? null,
		siteId: identity.siteId,
		updatedAt: current?.updatedAt ?? "",
	};
}

function withCapturedIds(
	state: InternalPortalNoticeSyncState,
	ids: number[],
): InternalPortalNoticeSyncState {
	if (ids.length === 0) {
		return state;
	}
	const min = Math.min(...ids);
	const max = Math.max(...ids);
	return {
		...state,
		maxCapturedId: state.maxCapturedId === null ? max : Math.max(state.maxCapturedId, max),
		minCapturedId: state.minCapturedId === null ? min : Math.min(state.minCapturedId, min),
	};
}

function parseNoticeId(value: NoticeItem["notice_id"]): number {
	const normalized =
		typeof value === "number"
			? value
			: typeof value === "string" && /^[1-9]\d*$/u.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(normalized) || normalized <= 0) {
		throw new Error(`notice type ${NOTICE_TYPE} returned an invalid notice_id`);
	}
	return normalized;
}

function parseTotalPages(response: NoticeListResponse): number {
	const value = response.datas?.page?.totalCounts;
	const totalItems =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/u.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
		throw new Error(`notice type ${NOTICE_TYPE} returned an invalid totalCounts item count`);
	}
	return Math.ceil(totalItems / NOTICE_PAGE_SIZE);
}

function earlierDate(current: string | null, next: string): string {
	return current === null || next < current ? next : current;
}

function sameState(
	left: InternalPortalNoticeSyncState,
	right: InternalPortalNoticeSyncState,
): boolean {
	return (
		left.historyCoveredFrom === right.historyCoveredFrom &&
		left.incrementalHeadId === right.incrementalHeadId &&
		left.maxCapturedId === right.maxCapturedId &&
		left.minCapturedId === right.minCapturedId &&
		left.siteId === right.siteId
	);
}

function result(
	mode: NoticeRunnerResult["mode"],
	state: InternalPortalNoticeSyncState,
	pagesFetched: number,
	counts: Pick<NoticeRunnerResult, "objectsReused" | "objectsWritten"> = {
		objectsReused: 0,
		objectsWritten: 0,
	},
): NoticeRunnerResult {
	return { mode, pagesFetched, state, ...counts };
}
