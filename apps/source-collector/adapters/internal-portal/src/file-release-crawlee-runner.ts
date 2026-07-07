import { BasicCrawler, type BasicCrawlingContext, type RequestOptions } from "crawlee";

import { createAuthenticatedNoticeCrawlerConfiguration } from "./crawlee-runtime.js";
import {
	normalizeDepartments,
	normalizeNullableText,
	normalizeObservedExplainDepartments,
	normalizeObservedFileCodeTypes,
	normalizeObservedFileTypes,
	normalizeOptionalId,
} from "./file-release-export-helpers.js";
import type {
	ApiRequestContextLike,
	FileReleaseCodeTypeListResponse,
	FileReleaseDetailResponse,
	FileReleaseDownloadUrlResponse,
	FileReleaseExplainDepartmentListResponse,
	FileReleaseListItem,
	FileReleasePageResponse,
	FileReleaseTypeListResponse,
} from "./types.js";

type FileReleaseCrawlRequestUserData =
	| {
			type: "types";
	  }
	| {
			currentPage: number;
			pageSize: number;
			type: "page";
	  }
	| {
			item: FileReleaseListItem;
			fileReleaseId: number;
			type: "detail";
	  }
	| {
			detail: FileReleaseDetailResponse;
			item: FileReleaseListItem;
			fileReleaseId: number;
			type: "download_url";
	  };

type FileReleaseCrawlingContext = BasicCrawlingContext<FileReleaseCrawlRequestUserData>;

export interface RunFileReleaseCrawleeCollectionInput {
	apiContext: ApiRequestContextLike;
	exportedAt: string;
	fetchFileReleaseCodeTypes: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseCodeTypeListResponse>;
	fetchFileReleaseDetail: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<FileReleaseDetailResponse>;
	fetchFileReleaseDownloadUrl: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<FileReleaseDownloadUrlResponse>;
	fetchFileReleaseExplainDepartments: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseExplainDepartmentListResponse>;
	fetchFileReleasePage: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		pageSize: number;
	}) => Promise<FileReleasePageResponse>;
	fetchFileReleaseTypes: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseTypeListResponse>;
	maxFileReleases: number | null;
	maxPages: number | null;
	pageSize: number;
	requestMaxRetries: number;
	siteId: string;
	targetFileReleaseId: number | null;
}

export interface RunFileReleaseCrawleeCollectionResult {
	collectedReleases: CollectedFileReleaseCandidate[];
	observedDepartments: string[];
	observedExplainDepartments: string[];
	observedFileCodeTypes: Array<{ id: number; name: string; sort: number | null }>;
	observedFileTypes: Array<{ id: number; typename: string; sort: number | null }>;
	stats: {
		detailFetched: number;
		fileUrlsResolved: number;
		itemsSeen: number;
		pagesFetched: number;
	};
}

export interface CollectedFileReleaseCandidate {
	detail: FileReleaseDetailResponse;
	downloadUrl: string | null;
	fileReleaseId: number;
	item: FileReleaseListItem;
}

interface FileReleaseCollectionState {
	collectedMap: Map<number, CollectedFileReleaseCandidate>;
	detailFetched: number;
	fileUrlsResolved: number;
	itemsSeen: number;
	observedDepartments: Set<string>;
	observedExplainDepartments: string[];
	observedFileCodeTypes: Array<{ id: number; name: string; sort: number | null }>;
	observedFileTypes: Array<{ id: number; typename: string; sort: number | null }>;
	pagesFetched: number;
	queuedFileReleaseIds: Set<number>;
}

const INTERNAL_REQUEST_BASE_URL = "https://collector.local/authenticated-notice/file-release";

export function buildFileReleaseTypesRequest(input: {
	siteId: string;
}): RequestOptions<FileReleaseCrawlRequestUserData> {
	return {
		label: "types",
		method: "POST",
		uniqueKey: `file_release_types:${input.siteId}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/types`,
		userData: { type: "types" },
	};
}

export function buildFileReleasePageRequest(input: {
	currentPage: number;
	pageSize: number;
	siteId: string;
}): RequestOptions<FileReleaseCrawlRequestUserData> {
	return {
		label: "page",
		method: "POST",
		uniqueKey: `file_release_page:${input.siteId}:${input.currentPage}:${input.pageSize}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/page`,
		userData: {
			currentPage: input.currentPage,
			pageSize: input.pageSize,
			type: "page",
		},
	};
}

function buildFileReleaseDetailRequest(input: {
	fileReleaseId: number;
	item: FileReleaseListItem;
	siteId: string;
}): RequestOptions<FileReleaseCrawlRequestUserData> {
	return {
		label: "detail",
		method: "POST",
		uniqueKey: `file_release_detail:${input.siteId}:${input.fileReleaseId}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/detail`,
		userData: {
			fileReleaseId: input.fileReleaseId,
			item: input.item,
			type: "detail",
		},
	};
}

function buildFileReleaseDownloadUrlRequest(input: {
	detail: FileReleaseDetailResponse;
	fileReleaseId: number;
	item: FileReleaseListItem;
	siteId: string;
}): RequestOptions<FileReleaseCrawlRequestUserData> {
	return {
		label: "download_url",
		method: "POST",
		uniqueKey: `file_release_download_url:${input.siteId}:${input.fileReleaseId}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/download-url`,
		userData: {
			detail: input.detail,
			fileReleaseId: input.fileReleaseId,
			item: input.item,
			type: "download_url",
		},
	};
}

export async function runFileReleaseCrawleeCollection(
	input: RunFileReleaseCrawleeCollectionInput,
): Promise<RunFileReleaseCrawleeCollectionResult> {
	const state: FileReleaseCollectionState = {
		collectedMap: new Map(),
		detailFetched: 0,
		fileUrlsResolved: 0,
		itemsSeen: 0,
		observedDepartments: new Set(),
		observedExplainDepartments: [],
		observedFileCodeTypes: [],
		observedFileTypes: [],
		pagesFetched: 0,
		queuedFileReleaseIds: new Set(),
	};
	const failedErrors: Error[] = [];
	const requestHandler = async (context: FileReleaseCrawlingContext) => {
		const userData = normalizeRequestUserData(context.request.userData);
		if (userData.type === "types") {
			const fileTypeResponse = await input.fetchFileReleaseTypes({ apiContext: input.apiContext });
			state.observedFileTypes = normalizeObservedFileTypes(fileTypeResponse);
			const fileCodeTypeResponse = await input.fetchFileReleaseCodeTypes({
				apiContext: input.apiContext,
			});
			state.observedFileCodeTypes = normalizeObservedFileCodeTypes(fileCodeTypeResponse);
			const explainDepartmentResponse = await input.fetchFileReleaseExplainDepartments({
				apiContext: input.apiContext,
			});
			state.observedExplainDepartments =
				normalizeObservedExplainDepartments(explainDepartmentResponse);
			await context.addRequests([
				buildFileReleasePageRequest({
					currentPage: 1,
					pageSize: input.pageSize,
					siteId: input.siteId,
				}),
			]);
			return;
		}
		if (userData.type === "page") {
			if (shouldStopBeforePage({ input, state, currentPage: userData.currentPage })) {
				return;
			}
			const pageResponse = await input.fetchFileReleasePage({
				apiContext: input.apiContext,
				currentPage: userData.currentPage,
				pageSize: userData.pageSize,
			});
			state.pagesFetched += 1;
			state.itemsSeen += pageResponse.data?.length ?? 0;
			for (const department of normalizeDepartments(pageResponse.dws)) {
				state.observedDepartments.add(department);
			}
			const pageItems = pageResponse.data ?? [];
			const detailRequests: RequestOptions<FileReleaseCrawlRequestUserData>[] = [];
			for (const item of pageItems) {
				const fileReleaseId = normalizeOptionalId(item.id);
				if (fileReleaseId === null || state.collectedMap.has(fileReleaseId)) {
					continue;
				}
				if (input.targetFileReleaseId !== null && fileReleaseId !== input.targetFileReleaseId) {
					continue;
				}
				if (
					input.maxFileReleases !== null &&
					state.collectedMap.size + detailRequests.length >= input.maxFileReleases
				) {
					break;
				}
				if (state.queuedFileReleaseIds.has(fileReleaseId)) {
					continue;
				}
				state.queuedFileReleaseIds.add(fileReleaseId);
				detailRequests.push(
					buildFileReleaseDetailRequest({
						fileReleaseId,
						item,
						siteId: input.siteId,
					}),
				);
			}
			if (detailRequests.length > 0) {
				await context.addRequests(detailRequests);
			}
			if (
				shouldQueueNextPage({
					detailRequestsQueued: detailRequests.length,
					input,
					pageItemsLength: pageItems.length,
					pageResponseSize: pageResponse.size,
					state,
					userData,
				})
			) {
				await context.addRequests([
					buildFileReleasePageRequest({
						currentPage: userData.currentPage + 1,
						pageSize: userData.pageSize,
						siteId: input.siteId,
					}),
				]);
			}
			return;
		}
		if (userData.type === "detail") {
			const detail = await input.fetchFileReleaseDetail({
				apiContext: input.apiContext,
				fileReleaseId: userData.fileReleaseId,
			});
			state.detailFetched += 1;
			await context.addRequests([
				buildFileReleaseDownloadUrlRequest({
					detail,
					fileReleaseId: userData.fileReleaseId,
					item: userData.item,
					siteId: input.siteId,
				}),
			]);
			return;
		}
		const downloadUrl = await input.fetchFileReleaseDownloadUrl({
			apiContext: input.apiContext,
			fileReleaseId: userData.fileReleaseId,
		});
		state.fileUrlsResolved += 1;
		state.collectedMap.set(userData.fileReleaseId, {
			detail: userData.detail,
			downloadUrl: normalizeNullableText(downloadUrl.url),
			fileReleaseId: userData.fileReleaseId,
			item: userData.item,
		});
	};
	const crawler = createDefaultFileReleaseCrawler({
		failedRequestHandler: async (_context, error) => {
			failedErrors.push(error);
		},
		maxRequestRetries: input.requestMaxRetries,
		requestHandler,
	});
	await crawler.run([buildFileReleaseTypesRequest({ siteId: input.siteId })]);
	if (failedErrors.length > 0) {
		throw failedErrors[0];
	}
	if (input.targetFileReleaseId !== null && !state.collectedMap.has(input.targetFileReleaseId)) {
		throw new Error(
			`target file_release_id ${input.targetFileReleaseId} was not found in file_release export scope`,
		);
	}
	return {
		collectedReleases: [...state.collectedMap.values()],
		observedDepartments: [...state.observedDepartments].sort((left, right) =>
			left.localeCompare(right, "zh-Hans-CN"),
		),
		observedExplainDepartments: state.observedExplainDepartments,
		observedFileCodeTypes: state.observedFileCodeTypes,
		observedFileTypes: state.observedFileTypes,
		stats: {
			detailFetched: state.detailFetched,
			fileUrlsResolved: state.fileUrlsResolved,
			itemsSeen: state.itemsSeen,
			pagesFetched: state.pagesFetched,
		},
	};
}

function shouldStopBeforePage(input: {
	currentPage: number;
	input: RunFileReleaseCrawleeCollectionInput;
	state: FileReleaseCollectionState;
}): boolean {
	if (input.input.maxPages !== null && input.currentPage > input.input.maxPages) {
		return true;
	}
	if (
		input.input.targetFileReleaseId !== null &&
		input.state.collectedMap.has(input.input.targetFileReleaseId)
	) {
		return true;
	}
	return (
		input.input.maxFileReleases !== null &&
		input.state.collectedMap.size >= input.input.maxFileReleases
	);
}

function shouldQueueNextPage(input: {
	detailRequestsQueued: number;
	input: RunFileReleaseCrawleeCollectionInput;
	pageItemsLength: number;
	pageResponseSize: number | undefined;
	state: FileReleaseCollectionState;
	userData: Extract<FileReleaseCrawlRequestUserData, { type: "page" }>;
}): boolean {
	if (input.pageItemsLength === 0 || input.pageItemsLength < input.userData.pageSize) {
		return false;
	}
	if (
		typeof input.pageResponseSize === "number" &&
		input.userData.currentPage * input.userData.pageSize >= input.pageResponseSize
	) {
		return false;
	}
	if (input.input.maxPages !== null && input.userData.currentPage + 1 > input.input.maxPages) {
		return false;
	}
	if (
		input.input.targetFileReleaseId !== null &&
		input.state.collectedMap.has(input.input.targetFileReleaseId)
	) {
		return false;
	}
	return !(
		input.input.maxFileReleases !== null &&
		input.state.collectedMap.size + input.detailRequestsQueued >= input.input.maxFileReleases
	);
}

function createDefaultFileReleaseCrawler(input: {
	failedRequestHandler: (context: FileReleaseCrawlingContext, error: Error) => Promise<void>;
	maxRequestRetries: number;
	requestHandler: (context: FileReleaseCrawlingContext) => Promise<void>;
}) {
	const crawler = new BasicCrawler<FileReleaseCrawlingContext>(
		{
			failedRequestHandler: input.failedRequestHandler,
			maxRequestRetries: input.maxRequestRetries,
			requestHandler: input.requestHandler,
		},
		createAuthenticatedNoticeCrawlerConfiguration("file-release"),
	);
	return {
		run: async (requests: RequestOptions<FileReleaseCrawlRequestUserData>[]) =>
			await crawler.run(requests),
	};
}

function normalizeRequestUserData(value: unknown): FileReleaseCrawlRequestUserData {
	if (!(value && typeof value === "object" && "type" in value)) {
		throw new Error("invalid file-release crawl request userData");
	}
	const candidate = value as FileReleaseCrawlRequestUserData;
	if (
		candidate.type === "types" ||
		candidate.type === "page" ||
		candidate.type === "detail" ||
		candidate.type === "download_url"
	) {
		return candidate;
	}
	throw new Error("invalid file-release crawl request type");
}
