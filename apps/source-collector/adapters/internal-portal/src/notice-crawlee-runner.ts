import { BasicCrawler, type BasicCrawlingContext, type RequestOptions } from "crawlee";
import { runCrawleeWithCancellation } from "../../../src/crawlee-cancellation.ts";
import { createAuthenticatedNoticeCrawlerConfiguration } from "./crawlee-runtime.js";
import { buildBundleRecord, type SelectedNoticeSpec } from "./notice-export-core.js";
import {
	mergeBundleRecord,
	normalizeNoticeType,
	normalizeObservedNoticeTypes,
	normalizeObservedOrganizations,
	normalizeOptionalNoticeId,
} from "./notice-export-helpers.js";
import * as noticeTypeConfig from "./notice-types.js";
import type {
	ApiRequestContextLike,
	BundleNoticeRecord,
	NoticeCollectionMode,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
	NoticeSelectsResponse,
	NoticeTypeConfig,
} from "./types.js";

type NoticeCrawlRequestUserData =
	| {
			type: "selects";
	  }
	| {
			type: "list_page";
			checkpointNoticeId: number | null;
			currentPage: number;
			noticeType: string;
			overlapPages: number;
			pageBudget: number;
			pageSize: number;
	  }
	| {
			type: "detail";
			notice: {
				notice_id: number;
				notice_title?: string;
				notice_type?: number | string;
				notice_type_name?: string;
			};
			noticeId: number;
			noticeType: string;
	  };

type NoticeCrawleeBasicContext = BasicCrawlingContext<NoticeCrawlRequestUserData>;

export interface NoticeCrawleeRunnerInput {
	abortSignal?: AbortSignal;
	collectionMode: NoticeCollectionMode;
	exportedAt: string;
	fetchNoticeDetail: (input: {
		apiContext: ApiRequestContextLike;
		noticeId: number;
		noticeType: string;
	}) => Promise<NoticeDetailResponse>;
	fetchNoticePage: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		noticeType: string;
		pageSize: number;
	}) => Promise<NoticeListResponse>;
	fetchNoticeSelects: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		pageSize: number;
	}) => Promise<NoticeSelectsResponse>;
	fullScopeRequested: boolean;
	apiContext?: ApiRequestContextLike;
	reconcileMaxPagesPerType: number | null;
	checkpoints?: NoticeCollectionCheckpoint[];
	maxNotices: number | null;
	noticeTypes: NoticeTypeConfig[];
	requestMaxRetries: number;
	overlapPages?: number;
	selectedNotices: SelectedNoticeSpec[];
	siteId: string;
	sourceHomeUrl: string;
}

export interface NoticeCollectionCheckpoint {
	notice_type: string;
	last_released_notice_id: number;
}

export interface NoticeCrawleeRunnerResult {
	bundleRecords: BundleNoticeRecord[];
	observedNoticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>;
	observedOrganizations: Array<{ organization_id: string; organization_name: string }>;
	checkpointGaps: NoticeCollectionCheckpoint[];
	nextCheckpoints: NoticeCollectionCheckpoint[];
	stats: {
		detailFetched: number;
		itemsSeen: number;
		pageBudgetExhausted: boolean;
		pagesFetched: number;
	};
}

interface NoticeCaptureState {
	bundleMap: Map<number, BundleNoticeRecord>;
	checkpointFoundPageByType: Map<string, number>;
	detailFetched: number;
	headNoticeIdByType: Map<string, number>;
	itemsSeen: number;
	lastFetchedPageByType: Map<string, number>;
	pageBudgetExhausted: boolean;
	pagesFetched: number;
	observedNoticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>;
	observedOrganizations: Array<{ organization_id: string; organization_name: string }>;
	observedListItemsByNoticeId: Map<number, NoticeItem[]>;
	queuedNoticeIds: Set<number>;
	totalPageCountByType: Map<string, number>;
}

const INTERNAL_REQUEST_BASE_URL = "https://collector.local/authenticated-notice";

export function buildNoticeSelectsRequest(input: {
	siteId: string;
}): RequestOptions<NoticeCrawlRequestUserData> {
	return {
		label: "selects",
		method: "POST",
		uniqueKey: `selects:${input.siteId}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/selects`,
		userData: { type: "selects" },
	};
}

export function buildNoticeListPageRequest(input: {
	checkpointNoticeId?: number | null;
	currentPage: number;
	noticeType: string;
	overlapPages?: number;
	pageBudget?: number;
	pageSize: number;
	siteId: string;
}): RequestOptions<NoticeCrawlRequestUserData> {
	return {
		label: "list_page",
		method: "POST",
		uniqueKey: `list_page:${input.siteId}:${input.noticeType}:${input.currentPage}:${input.pageSize}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/list-page`,
		userData: {
			checkpointNoticeId: input.checkpointNoticeId ?? null,
			currentPage: input.currentPage,
			noticeType: input.noticeType,
			overlapPages: input.overlapPages ?? 1,
			pageBudget: input.pageBudget ?? input.currentPage,
			pageSize: input.pageSize,
			type: "list_page",
		},
	};
}

export function buildNoticeDetailRequest(input: {
	notice?: {
		notice_id: number;
		notice_title?: string;
		notice_type?: number | string;
		notice_type_name?: string;
	};
	noticeId: number;
	noticeType: string;
	siteId: string;
}): RequestOptions<NoticeCrawlRequestUserData> {
	return {
		label: "detail",
		method: "POST",
		uniqueKey: buildNoticeDetailKey(input),
		url: `${INTERNAL_REQUEST_BASE_URL}/detail`,
		userData: {
			notice: input.notice ?? {
				notice_id: input.noticeId,
				notice_type: input.noticeType,
			},
			noticeId: input.noticeId,
			noticeType: input.noticeType,
			type: "detail",
		},
	};
}

function buildNoticeDetailKey(input: { noticeId: number; siteId: string }): string {
	return `detail:${input.siteId}:${input.noticeId}`;
}

export async function runNoticeCrawleeCollection(
	input: NoticeCrawleeRunnerInput,
): Promise<NoticeCrawleeRunnerResult> {
	const state: NoticeCaptureState = {
		bundleMap: new Map<number, BundleNoticeRecord>(),
		checkpointFoundPageByType: new Map<string, number>(),
		detailFetched: 0,
		headNoticeIdByType: new Map<string, number>(),
		itemsSeen: 0,
		lastFetchedPageByType: new Map<string, number>(),
		observedNoticeTypes: [],
		observedOrganizations: [],
		observedListItemsByNoticeId: new Map<number, NoticeItem[]>(),
		pageBudgetExhausted: false,
		pagesFetched: 0,
		queuedNoticeIds: new Set(input.selectedNotices.map((notice) => notice.noticeId)),
		totalPageCountByType: new Map<string, number>(),
	};
	const apiContext = input.apiContext ?? noopApiContext;
	const requestHandler = async (context: NoticeCrawleeBasicContext) => {
		input.abortSignal?.throwIfAborted();
		const userData = normalizeRequestUserData(context.request.userData);
		if (userData.type === "selects") {
			const noticeSelects = await input.fetchNoticeSelects({
				apiContext,
				currentPage: 1,
				pageSize: 15,
			});
			input.abortSignal?.throwIfAborted();
			state.observedNoticeTypes = normalizeObservedNoticeTypes(noticeSelects);
			state.observedOrganizations = normalizeObservedOrganizations(noticeSelects);
			return;
		}
		if (userData.type === "list_page") {
			if (input.maxNotices !== null && state.bundleMap.size >= input.maxNotices) {
				return;
			}
			const pageResponse = await input.fetchNoticePage({
				apiContext,
				currentPage: userData.currentPage,
				noticeType: userData.noticeType,
				pageSize: userData.pageSize,
			});
			input.abortSignal?.throwIfAborted();
			state.pagesFetched += 1;
			state.lastFetchedPageByType.set(userData.noticeType, userData.currentPage);
			const items = pageResponse.datas?.tables ?? [];
			state.itemsSeen += items.length;
			const detailRequests: RequestOptions<NoticeCrawlRequestUserData>[] = [];
			for (const item of items) {
				const noticeId = normalizeOptionalNoticeId(item.notice_id);
				if (noticeId === null) {
					continue;
				}
				const currentHead = state.headNoticeIdByType.get(userData.noticeType) ?? 0;
				state.headNoticeIdByType.set(userData.noticeType, Math.max(currentHead, noticeId));
				if (
					userData.checkpointNoticeId === noticeId &&
					!state.checkpointFoundPageByType.has(userData.noticeType)
				) {
					state.checkpointFoundPageByType.set(userData.noticeType, userData.currentPage);
				}
				const observedItems = state.observedListItemsByNoticeId.get(noticeId) ?? [];
				observedItems.push(item);
				state.observedListItemsByNoticeId.set(noticeId, observedItems);
				const existing = state.bundleMap.get(noticeId);
				if (existing) {
					state.bundleMap.set(noticeId, mergeBundleRecord(existing, item, input.exportedAt));
					continue;
				}
				if (state.queuedNoticeIds.has(noticeId)) {
					continue;
				}
				if (input.maxNotices !== null && state.queuedNoticeIds.size >= input.maxNotices) {
					break;
				}
				const noticeType = normalizeNoticeType(item.notice_type ?? userData.noticeType);
				state.queuedNoticeIds.add(noticeId);
				detailRequests.push(
					buildNoticeDetailRequest({
						notice: {
							notice_id: noticeId,
							notice_title: item.notice_title,
							notice_type: item.notice_type ?? userData.noticeType,
							notice_type_name: item.notice_type_name,
						},
						noticeId,
						noticeType,
						siteId: input.siteId,
					}),
				);
			}
			if (detailRequests.length > 0) {
				input.abortSignal?.throwIfAborted();
				await context.addRequests(detailRequests);
			}
			const totalCounts = pageResponse.datas?.page?.totalCounts;
			if (typeof totalCounts === "number") {
				state.totalPageCountByType.set(userData.noticeType, totalCounts);
			}
			if (
				typeof totalCounts === "number" &&
				totalCounts > userData.currentPage &&
				userData.currentPage >= userData.pageBudget
			) {
				state.pageBudgetExhausted = true;
			}
			const checkpointFoundPage = state.checkpointFoundPageByType.get(userData.noticeType);
			const lastRequiredPage =
				checkpointFoundPage === undefined
					? userData.pageBudget
					: Math.min(userData.pageBudget, checkpointFoundPage + userData.overlapPages);
			if (
				typeof totalCounts === "number" &&
				userData.currentPage < totalCounts &&
				userData.currentPage < lastRequiredPage &&
				(input.maxNotices === null || state.queuedNoticeIds.size < input.maxNotices)
			) {
				input.abortSignal?.throwIfAborted();
				await context.addRequests([
					buildNoticeListPageRequest({
						currentPage: userData.currentPage + 1,
						checkpointNoticeId: userData.checkpointNoticeId,
						noticeType: userData.noticeType,
						overlapPages: userData.overlapPages,
						pageBudget: userData.pageBudget,
						pageSize: userData.pageSize,
						siteId: input.siteId,
					}),
				]);
			}
			return;
		}
		const detailResponse = await input.fetchNoticeDetail({
			apiContext,
			noticeId: userData.noticeId,
			noticeType: userData.noticeType,
		});
		input.abortSignal?.throwIfAborted();
		state.detailFetched += 1;
		const detailInfo = detailResponse.datas?.notice_info;
		const noticeTypeName =
			userData.notice.notice_type_name ??
			detailInfo?.notice_type_name ??
			findNoticeTypeName(input.noticeTypes, userData.noticeType) ??
			findObservedNoticeTypeName(state.observedNoticeTypes, userData.noticeType);
		let bundleRecord = buildBundleRecord({
			detailInfo,
			notice: {
				...userData.notice,
				notice_id: userData.noticeId,
				notice_title: userData.notice.notice_title ?? detailInfo?.notice_title ?? undefined,
				notice_type: userData.noticeType,
				notice_type_name: noticeTypeName,
			},
			observedAt: input.exportedAt,
			sourceHomeUrl: input.sourceHomeUrl,
		});
		for (const observedItem of state.observedListItemsByNoticeId.get(userData.noticeId) ?? []) {
			bundleRecord = mergeBundleRecord(bundleRecord, observedItem, input.exportedAt);
		}
		state.bundleMap.set(userData.noticeId, bundleRecord);
	};
	if (input.selectedNotices.length > 0) {
		state.itemsSeen = input.selectedNotices.length;
	}

	const failedRequests: Error[] = [];
	const crawler = createDefaultNoticeCrawler({
		failedRequestHandler: async (_context, error) => {
			failedRequests.push(error);
		},
		maxRequestRetries: input.requestMaxRetries,
		requestHandler,
	});
	await runCrawleeWithCancellation({
		abortSignal: input.abortSignal,
		crawler,
		requests: buildInitialRequests(input),
	});
	if (failedRequests[0]) {
		throw failedRequests[0];
	}
	const checkpoints = normalizeCheckpoints(input.checkpoints ?? []);
	const enabledTypes = new Set(
		noticeTypeConfig.getEnabledNoticeTypes(input.noticeTypes).map((noticeType) => noticeType.type),
	);
	const checkpointGaps = checkpoints.filter((checkpoint) => {
		if (!enabledTypes.has(checkpoint.notice_type)) {
			return false;
		}
		const foundPage = state.checkpointFoundPageByType.get(checkpoint.notice_type);
		const fetchedPage = state.lastFetchedPageByType.get(checkpoint.notice_type);
		const totalPages = state.totalPageCountByType.get(checkpoint.notice_type);
		if (foundPage === undefined || fetchedPage === undefined || totalPages === undefined) {
			return true;
		}
		const requiredLastPage = Math.min(totalPages, foundPage + (input.overlapPages ?? 1));
		return fetchedPage < requiredLastPage;
	});
	const nextByType = new Map(checkpoints.map((checkpoint) => [checkpoint.notice_type, checkpoint]));
	for (const [noticeType, noticeId] of state.headNoticeIdByType) {
		nextByType.set(noticeType, {
			last_released_notice_id: noticeId,
			notice_type: noticeType,
		});
	}

	return {
		bundleRecords: [...state.bundleMap.values()],
		observedNoticeTypes: state.observedNoticeTypes,
		observedOrganizations: state.observedOrganizations,
		checkpointGaps,
		nextCheckpoints: [...nextByType.values()]
			.filter((checkpoint) => enabledTypes.has(checkpoint.notice_type))
			.sort((left, right) => left.notice_type.localeCompare(right.notice_type)),
		stats: {
			detailFetched: state.detailFetched,
			itemsSeen: state.itemsSeen,
			pageBudgetExhausted: state.pageBudgetExhausted,
			pagesFetched: state.pagesFetched,
		},
	};
}

function buildInitialRequests(
	input: NoticeCrawleeRunnerInput,
): RequestOptions<NoticeCrawlRequestUserData>[] {
	const requests: RequestOptions<NoticeCrawlRequestUserData>[] = [
		buildNoticeSelectsRequest({ siteId: input.siteId }),
	];
	if (input.selectedNotices.length > 0) {
		requests.push(
			...input.selectedNotices.map((selectedNotice) =>
				buildNoticeDetailRequest({
					notice: {
						notice_id: selectedNotice.noticeId,
						notice_title: selectedNotice.noticeTitle,
						notice_type: selectedNotice.noticeType,
						notice_type_name: selectedNotice.noticeTypeName,
					},
					noticeId: selectedNotice.noticeId,
					noticeType: selectedNotice.noticeType,
					siteId: input.siteId,
				}),
			),
		);
		return requests;
	}
	const enabledNoticeTypes = noticeTypeConfig.getEnabledNoticeTypes(input.noticeTypes);
	const checkpoints = new Map(
		normalizeCheckpoints(input.checkpoints ?? []).map((checkpoint) => [
			checkpoint.notice_type,
			checkpoint.last_released_notice_id,
		]),
	);
	for (const noticeType of enabledNoticeTypes) {
		const checkpointNoticeId = checkpoints.get(noticeType.type) ?? null;
		const pageBudget =
			input.collectionMode === "reconcile"
				? (input.reconcileMaxPagesPerType ?? noticeType.reconcilePages)
				: checkpointNoticeId === null
					? noticeType.incrementalPages
					: (input.reconcileMaxPagesPerType ?? noticeType.reconcilePages);
		const pageSize =
			input.collectionMode === "reconcile"
				? noticeType.reconcilePageSize
				: noticeType.incrementalPageSize;
		requests.push(
			buildNoticeListPageRequest({
				checkpointNoticeId,
				currentPage: 1,
				noticeType: noticeType.type,
				overlapPages: input.overlapPages ?? 1,
				pageBudget,
				pageSize,
				siteId: input.siteId,
			}),
		);
	}
	return requests;
}

function normalizeCheckpoints(
	checkpoints: readonly NoticeCollectionCheckpoint[],
): NoticeCollectionCheckpoint[] {
	const byType = new Map<string, NoticeCollectionCheckpoint>();
	for (const checkpoint of checkpoints) {
		const noticeType = checkpoint.notice_type.trim();
		if (!(noticeType && Number.isSafeInteger(checkpoint.last_released_notice_id))) {
			continue;
		}
		if (byType.has(noticeType)) {
			throw new Error(`duplicate notice checkpoint: ${noticeType}`);
		}
		byType.set(noticeType, {
			last_released_notice_id: checkpoint.last_released_notice_id,
			notice_type: noticeType,
		});
	}
	return [...byType.values()];
}

function createDefaultNoticeCrawler(input: {
	failedRequestHandler: (context: NoticeCrawleeBasicContext, error: Error) => Promise<void>;
	maxRequestRetries: number;
	requestHandler: (context: NoticeCrawleeBasicContext) => Promise<void>;
}) {
	const crawler = new BasicCrawler<NoticeCrawleeBasicContext>(
		{
			failedRequestHandler: input.failedRequestHandler,
			maxConcurrency: 2,
			maxRequestsPerMinute: 60,
			maxRequestRetries: input.maxRequestRetries,
			requestHandler: input.requestHandler,
		},
		createAuthenticatedNoticeCrawlerConfiguration("notice"),
	);
	return {
		run: async (requests: RequestOptions<NoticeCrawlRequestUserData>[]) =>
			await crawler.run(requests),
		stop: async (reason?: string) => await crawler.stop(reason),
	};
}

function normalizeRequestUserData(value: unknown): NoticeCrawlRequestUserData {
	if (!(value && typeof value === "object" && "type" in value)) {
		throw new Error("invalid notice crawl request userData");
	}
	const candidate = value as NoticeCrawlRequestUserData;
	if (
		candidate.type === "selects" ||
		candidate.type === "list_page" ||
		candidate.type === "detail"
	) {
		return candidate;
	}
	throw new Error("invalid notice crawl request type");
}

function findNoticeTypeName(
	noticeTypes: NoticeTypeConfig[],
	noticeType: string,
): string | undefined {
	return noticeTypes.find((item) => item.type === noticeType)?.name;
}

function findObservedNoticeTypeName(
	noticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>,
	noticeType: string,
): string | undefined {
	const parsed = Number(noticeType);
	if (!Number.isInteger(parsed)) {
		return;
	}
	return noticeTypes.find((item) => item.notice_type_id === parsed)?.notice_type_name;
}

const noopApiContext: ApiRequestContextLike = {
	async get() {
		throw new Error("notice Crawlee runner requires an api context for portal GET requests");
	},
	async post() {
		throw new Error("notice Crawlee runner requires an api context for portal POST requests");
	},
};
