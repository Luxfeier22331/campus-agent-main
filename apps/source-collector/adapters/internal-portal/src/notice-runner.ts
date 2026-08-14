import type { InternalPortalNoticeMetaStore } from "./notice-meta-store.js";
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
	NoticeMetadataResponse,
} from "./types.js";

const NOTICE_PAGE_SIZE = 20;

export interface NoticeRunnerInput {
	apiContext: ApiRequestContextLike;
	fetchNoticeDetail: (input: {
		apiContext: ApiRequestContextLike;
		noticeId: number;
	}) => Promise<NoticeDetailResponse>;
	fetchNoticeMetadata: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<NoticeMetadataResponse>;
	fetchNoticePage: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		startDate: string;
	}) => Promise<NoticeListResponse>;
	metaStore: InternalPortalNoticeMetaStore;
	now?: () => string;
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

interface NoticeCandidate {
	item: NoticeItem;
	noticeId: number;
	noticeType: number;
}

interface NoticeMappings {
	noticeTypes: Record<string, string>;
	organizations: Record<string, string>;
}

interface NoticeScan {
	candidates: NoticeCandidate[];
	firstObservedId: number | null;
	pagesFetched: number;
}

export async function syncInternalPortalNotices(
	input: NoticeRunnerInput,
): Promise<NoticeRunnerResult> {
	const current = await input.stateStore.load();
	const mappings = await fetchMappings(input);
	const allowedTypes = new Set(Object.keys(mappings.noticeTypes).map(Number));
	if (!current) {
		const page = await fetchPage(input, 1, "");
		parseTotalPages(page);
		const items = parseNoticeItems(page.datas?.tables ?? [], allowedTypes);
		const updatedAt = now(input);
		await saveMappings(input, mappings, updatedAt);
		const state = await saveState(input, stateWith(null, items.firstObservedId), updatedAt);
		return result("sync", state, 1);
	}
	if (current.headNoticeId === null) {
		const scan = await scanBackfillNotices(input, "", allowedTypes);
		const counts = await writeCandidates(input, scan.candidates);
		const updatedAt = now(input);
		await saveMappings(input, mappings, updatedAt);
		if (scan.firstObservedId === null) {
			return result("sync", current, scan.pagesFetched, counts);
		}
		const state = await saveState(
			input,
			{ ...current, headNoticeId: scan.firstObservedId },
			updatedAt,
		);
		return result("sync", state, scan.pagesFetched, counts);
	}

	const scan = await scanIncrementalNotices(input, current.headNoticeId, allowedTypes);
	const counts = await writeCandidates(input, scan.candidates);
	const updatedAt = now(input);
	await saveMappings(input, mappings, updatedAt);
	if (scan.firstObservedId === null || scan.firstObservedId === current.headNoticeId) {
		return result("sync", current, scan.pagesFetched, counts);
	}
	const state = await saveState(
		input,
		{ ...current, headNoticeId: scan.firstObservedId },
		updatedAt,
	);
	return result("sync", state, scan.pagesFetched, counts);
}

export async function backfillInternalPortalNotices(
	input: NoticeRunnerInput & { startDate: string },
): Promise<NoticeRunnerResult> {
	const startDate = parseNoticeStartDate(input.startDate);
	const current = await input.stateStore.load();
	if (current && isNoticeHistoryCovered(current, startDate)) {
		return result("backfill", current, 0);
	}

	const mappings = await fetchMappings(input);
	const allowedTypes = new Set(Object.keys(mappings.noticeTypes).map(Number));
	const scan = await scanBackfillNotices(input, startDate, allowedTypes);
	let pagesFetched = scan.pagesFetched;
	let headNoticeId = current?.headNoticeId ?? scan.firstObservedId;
	if (!current && headNoticeId === null) {
		const baselinePage = await fetchPage(input, 1, "");
		parseTotalPages(baselinePage);
		headNoticeId = parseNoticeItems(baselinePage.datas?.tables ?? [], allowedTypes).firstObservedId;
		pagesFetched += 1;
	}
	const counts = await writeCandidates(input, scan.candidates);
	const updatedAt = now(input);
	await saveMappings(input, mappings, updatedAt);
	let updated: InternalPortalNoticeSyncState = {
		...stateWith(current, headNoticeId),
		historyCoveredFrom: earlierDate(current?.historyCoveredFrom ?? null, startDate),
	};
	if (!(current && sameState(current, updated))) {
		updated = await saveState(input, updated, updatedAt);
	}
	return result("backfill", updated, pagesFetched, counts);
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
	allowedTypes: Set<number>,
): Promise<NoticeScan> {
	const candidates: NoticeCandidate[] = [];
	let foundHead = false;
	let firstObservedId: number | null = null;
	let pagesFetched = 0;
	const seenIds = new Set<number>();
	let totalPages: number | null = null;

	for (let currentPage = 1; totalPages === null || currentPage <= totalPages; currentPage += 1) {
		const page = await fetchPage(input, currentPage, "");
		pagesFetched += 1;
		totalPages ??= parseTotalPages(page);
		for (const item of page.datas?.tables ?? []) {
			const candidate = parseNoticeItem(item);
			if (seenIds.has(candidate.noticeId)) {
				continue;
			}
			seenIds.add(candidate.noticeId);
			firstObservedId ??= candidate.noticeId;
			if (candidate.noticeId === currentHeadId) {
				foundHead = true;
				break;
			}
			if (allowedTypes.has(candidate.noticeType)) {
				candidates.push(candidate);
			}
		}
		if (foundHead) {
			break;
		}
	}

	if (!foundHead) {
		throw new Error(`internal portal notice list did not return head ${currentHeadId}`);
	}
	return { candidates, firstObservedId, pagesFetched };
}

async function scanBackfillNotices(
	input: NoticeRunnerInput,
	startDate: string,
	allowedTypes: Set<number>,
): Promise<NoticeScan> {
	const candidates: NoticeCandidate[] = [];
	let firstObservedId: number | null = null;
	let pagesFetched = 0;
	const seenIds = new Set<number>();
	let totalPages: number | null = null;

	for (let currentPage = 1; totalPages === null || currentPage <= totalPages; currentPage += 1) {
		const page = await fetchPage(input, currentPage, startDate);
		pagesFetched += 1;
		totalPages ??= parseTotalPages(page);
		for (const item of page.datas?.tables ?? []) {
			const candidate = parseNoticeItem(item);
			if (seenIds.has(candidate.noticeId)) {
				continue;
			}
			seenIds.add(candidate.noticeId);
			firstObservedId ??= candidate.noticeId;
			if (allowedTypes.has(candidate.noticeType)) {
				candidates.push(candidate);
			}
		}
	}

	return { candidates, firstObservedId, pagesFetched };
}

function parseNoticeItems(
	items: NoticeItem[],
	allowedTypes: Set<number>,
): { candidates: NoticeCandidate[]; firstObservedId: number | null } {
	const candidates: NoticeCandidate[] = [];
	const seenIds = new Set<number>();
	let firstObservedId: number | null = null;
	for (const item of items) {
		const candidate = parseNoticeItem(item);
		if (seenIds.has(candidate.noticeId)) {
			continue;
		}
		seenIds.add(candidate.noticeId);
		firstObservedId ??= candidate.noticeId;
		if (allowedTypes.has(candidate.noticeType)) {
			candidates.push(candidate);
		}
	}
	return { candidates, firstObservedId };
}

function parseNoticeItem(item: NoticeItem): NoticeCandidate {
	return {
		item,
		noticeId: parsePositiveInteger(item.notice_id, "notice_id"),
		noticeType: parsePositiveInteger(item.notice_type, "notice_type"),
	};
}

async function fetchPage(
	input: NoticeRunnerInput,
	currentPage: number,
	startDate: string,
): Promise<NoticeListResponse> {
	return await input.fetchNoticePage({ apiContext: input.apiContext, currentPage, startDate });
}

async function fetchMappings(input: NoticeRunnerInput): Promise<NoticeMappings> {
	const response = await input.fetchNoticeMetadata({ apiContext: input.apiContext });
	const noticeTypes: Record<string, string> = {};
	for (const item of response.datas?.type ?? []) {
		const id = parsePositiveInteger(item.notice_type_id, "notice_type_id");
		const name = requireText(item.notice_type_name, "notice_type_name");
		assertNewMapping(noticeTypes, String(id), name, "notice type");
	}
	if (Object.keys(noticeTypes).length === 0) {
		throw new Error("internal portal notice metadata returned no notice types");
	}
	const organizations: Record<string, string> = {};
	for (const item of response.datas?.org ?? []) {
		const id = requireText(item.organization_id, "organization_id");
		const name = requireText(item.organization_name, "organization_name");
		assertNewMapping(organizations, id, name, "organization");
	}
	return { noticeTypes, organizations };
}

function assertNewMapping(
	mappings: Record<string, string>,
	id: string,
	name: string,
	label: string,
): void {
	if (Object.hasOwn(mappings, id)) {
		throw new Error(`internal portal notice metadata returned duplicate ${label} ${id}`);
	}
	mappings[id] = name;
}

async function writeCandidates(
	input: NoticeRunnerInput,
	candidates: NoticeCandidate[],
): Promise<{ objectsReused: number; objectsWritten: number }> {
	let objectsReused = 0;
	let objectsWritten = 0;
	for (const candidate of candidates) {
		if (await input.sourceStore.has(candidate.noticeId)) {
			objectsReused += 1;
			continue;
		}
		const detail = await input.fetchNoticeDetail({
			apiContext: input.apiContext,
			noticeId: candidate.noticeId,
		});
		const detailInfo = detail.datas?.notice_info;
		if (!detailInfo) {
			throw new Error(`notice ${candidate.noticeId} detail is missing notice_info`);
		}
		const source = buildInternalPortalNoticeSource({
			detailInfo,
			listItem: candidate.item,
			noticeId: candidate.noticeId,
			noticeType: candidate.noticeType,
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

async function saveMappings(
	input: NoticeRunnerInput,
	mappings: NoticeMappings,
	updatedAt: string,
): Promise<void> {
	await input.metaStore.putMappings({ ...mappings, updatedAt });
}

async function saveState(
	input: NoticeRunnerInput,
	state: InternalPortalNoticeSyncState,
	updatedAt: string,
): Promise<InternalPortalNoticeSyncState> {
	const updated = { ...state, updatedAt };
	await input.stateStore.save(updated);
	return updated;
}

function stateWith(
	current: InternalPortalNoticeSyncState | null,
	headNoticeId: number | null,
): InternalPortalNoticeSyncState {
	return {
		headNoticeId,
		historyCoveredFrom: current?.historyCoveredFrom ?? null,
		updatedAt: current?.updatedAt ?? "",
	};
}

function parsePositiveInteger(value: number | string | null | undefined, field: string): number {
	const normalized =
		typeof value === "number"
			? value
			: typeof value === "string" && /^[1-9]\d*$/u.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(normalized) || normalized <= 0) {
		throw new Error(`internal portal notice response returned an invalid ${field}`);
	}
	return normalized;
}

function parseTotalPages(response: NoticeListResponse): number {
	const page = response.datas?.page;
	const totalItems = parseNonNegativeInteger(page?.total);
	const totalPages = parseNonNegativeInteger(page?.totalCounts);
	const pageSize = parseInteger(page?.pageSize);
	if (
		!(Number.isSafeInteger(totalItems) && Number.isSafeInteger(totalPages)) ||
		pageSize !== NOTICE_PAGE_SIZE ||
		Math.ceil(totalItems / pageSize) !== totalPages
	) {
		throw new Error("internal portal notice list returned invalid pagination metadata");
	}
	return totalPages;
}

function parseNonNegativeInteger(value: number | string | undefined): number {
	const normalized = parseInteger(value);
	return normalized >= 0 ? normalized : Number.NaN;
}

function parseInteger(value: number | string | undefined): number {
	return typeof value === "number"
		? value
		: typeof value === "string" && /^\d+$/u.test(value.trim())
			? Number(value.trim())
			: Number.NaN;
}

function requireText(value: string | null | undefined, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) {
		throw new Error(`internal portal notice metadata returned an invalid ${field}`);
	}
	return normalized;
}

function earlierDate(current: string | null, next: string): string {
	return current === null || next < current ? next : current;
}

function sameState(
	left: InternalPortalNoticeSyncState,
	right: InternalPortalNoticeSyncState,
): boolean {
	return (
		left.historyCoveredFrom === right.historyCoveredFrom && left.headNoticeId === right.headNoticeId
	);
}

function now(input: NoticeRunnerInput): string {
	return (input.now ?? (() => new Date().toISOString()))();
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
