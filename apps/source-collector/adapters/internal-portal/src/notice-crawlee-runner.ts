import { BasicCrawler, type BasicCrawlingContext, type RequestOptions } from "crawlee";
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
			currentPage: number;
			noticeType: string;
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
	backfillMaxPagesPerType: number | null;
	maxNotices: number | null;
	noticeTypes: NoticeTypeConfig[];
	requestMaxRetries: number;
	selectedNotices: SelectedNoticeSpec[];
	siteId: string;
	sourceHomeUrl: string;
}

export interface NoticeCrawleeRunnerResult {
	bundleRecords: BundleNoticeRecord[];
	observedNoticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>;
	observedOrganizations: Array<{ organization_id: string; organization_name: string }>;
	stats: {
		detailFetched: number;
		itemsSeen: number;
		pageBudgetExhausted: boolean;
		pagesFetched: number;
	};
}

interface NoticeCaptureState {
	bundleMap: Map<number, BundleNoticeRecord>;
	detailFetched: number;
	itemsSeen: number;
	pageBudgetExhausted: boolean;
	pagesFetched: number;
	observedNoticeTypes: Array<{ notice_type_id: number; notice_type_name: string }>;
	observedOrganizations: Array<{ organization_id: string; organization_name: string }>;
	observedListItemsByNoticeId: Map<number, NoticeItem[]>;
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
	currentPage: number;
	noticeType: string;
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
			currentPage: input.currentPage,
			noticeType: input.noticeType,
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
		detailFetched: 0,
		itemsSeen: 0,
		observedNoticeTypes: [],
		observedOrganizations: [],
		observedListItemsByNoticeId: new Map<number, NoticeItem[]>(),
		pageBudgetExhausted: false,
		pagesFetched: 0,
	};
	const apiContext = input.apiContext ?? noopApiContext;
	const requestHandler = async (context: NoticeCrawleeBasicContext) => {
		const userData = normalizeRequestUserData(context.request.userData);
		if (userData.type === "selects") {
			const noticeSelects = await input.fetchNoticeSelects({
				apiContext,
				currentPage: 1,
				pageSize: 15,
			});
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
			state.pagesFetched += 1;
			const items = pageResponse.datas?.tables ?? [];
			state.itemsSeen += items.length;
			const detailRequests: RequestOptions<NoticeCrawlRequestUserData>[] = [];
			for (const item of items) {
				const noticeId = normalizeOptionalNoticeId(item.notice_id);
				if (noticeId === null) {
					continue;
				}
				const observedItems = state.observedListItemsByNoticeId.get(noticeId) ?? [];
				observedItems.push(item);
				state.observedListItemsByNoticeId.set(noticeId, observedItems);
				const existing = state.bundleMap.get(noticeId);
				if (existing) {
					state.bundleMap.set(noticeId, mergeBundleRecord(existing, item, input.exportedAt));
					continue;
				}
				if (
					input.maxNotices !== null &&
					state.bundleMap.size + detailRequests.length >= input.maxNotices
				) {
					break;
				}
				const noticeType = normalizeNoticeType(item.notice_type ?? userData.noticeType);
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
				await context.addRequests(detailRequests);
			}
			const totalCounts = pageResponse.datas?.page?.totalCounts;
			if (
				typeof totalCounts === "number" &&
				totalCounts > userData.currentPage &&
				userData.currentPage >= userData.pageBudget
			) {
				state.pageBudgetExhausted = true;
			}
			if (
				typeof totalCounts === "number" &&
				userData.currentPage < totalCounts &&
				userData.currentPage < userData.pageBudget &&
				(input.maxNotices === null ||
					state.bundleMap.size + detailRequests.length < input.maxNotices)
			) {
				await context.addRequests([
					buildNoticeListPageRequest({
						currentPage: userData.currentPage + 1,
						noticeType: userData.noticeType,
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

	const crawler = createDefaultNoticeCrawler({
		maxRequestRetries: input.requestMaxRetries,
		requestHandler,
	});
	await crawler.run(buildInitialRequests(input));

	return {
		bundleRecords: [...state.bundleMap.values()],
		observedNoticeTypes: state.observedNoticeTypes,
		observedOrganizations: state.observedOrganizations,
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
	for (const noticeType of enabledNoticeTypes) {
		const pageBudget =
			input.collectionMode === "backfill"
				? (input.backfillMaxPagesPerType ?? noticeType.backfillPages)
				: noticeType.incrementalPages;
		const pageSize =
			input.collectionMode === "backfill"
				? noticeType.backfillPageSize
				: noticeType.incrementalPageSize;
		requests.push(
			buildNoticeListPageRequest({
				currentPage: 1,
				noticeType: noticeType.type,
				pageBudget,
				pageSize,
				siteId: input.siteId,
			}),
		);
	}
	return requests;
}

function createDefaultNoticeCrawler(input: {
	maxRequestRetries: number;
	requestHandler: (context: NoticeCrawleeBasicContext) => Promise<void>;
}) {
	const crawler = new BasicCrawler<NoticeCrawleeBasicContext>(
		{
			maxRequestRetries: input.maxRequestRetries,
			requestHandler: input.requestHandler,
		},
		createAuthenticatedNoticeCrawlerConfiguration("notice"),
	);
	return {
		run: async (requests: RequestOptions<NoticeCrawlRequestUserData>[]) =>
			await crawler.run(requests),
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
