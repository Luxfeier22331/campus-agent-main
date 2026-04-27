import { createHash } from "node:crypto";
import {
	buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage,
	type CapturedWeChatOfficialAccountArticlePage,
} from "wechat-official-account-core";

import type { StoredArtifactRef, WeChatOfficialAccountArtifactStore } from "./artifact-store.ts";
import {
	type FeedWeHistoryPage,
	type FeedWeProviderConfig,
	fetchFeedWeHistoryPage,
} from "./feedwe-client.ts";
import { writeWeChatOfficialAccountSourceTruthArtifacts } from "./replay-source-truth.ts";
import { fetchWeChatOfficialAccountArticlePage } from "./wechat-article-page.ts";

export interface CaptureFeedWeHistoryInput {
	accountName: string;
	accountSlug?: string;
	artifactStore: WeChatOfficialAccountArtifactStore;
	begin?: string;
	fetchImplementation?: typeof fetch;
	maxArticles: number;
	maxPages: number;
	now?: () => Date;
	provider: FeedWeProviderConfig;
	size: number;
}

export type FeedWeCapturePlanningOutcome =
	| "complete"
	| "article_budget_exhausted"
	| "page_budget_exhausted";

export interface WeChatOfficialAccountCaptureArtifactRef extends StoredArtifactRef {
	artifactType:
		| "provider_response"
		| "request_summary"
		| "page_fetch_metadata"
		| "page_raw_html"
		| "source_truth_article_manifest"
		| "source_truth_content_blocks"
		| "source_truth_media_refs";
}

export interface CaptureFeedWeHistoryResult {
	accountSlug: string;
	artifacts: WeChatOfficialAccountCaptureArtifactRef[];
	planningOutcome: FeedWeCapturePlanningOutcome;
	summary: {
		artifactUploads: number;
		articlesMaterialized: number;
		articlesSeen: number;
		failures: number;
		pagesFetched: number;
		pageCaptureArtifacts: number;
		pageCapturesFailed: number;
		pageCapturesSucceeded: number;
		sourceTruthArtifacts: number;
	};
}

const textEncoder = new TextEncoder();

export async function captureFeedWeHistory(
	input: CaptureFeedWeHistoryInput,
): Promise<CaptureFeedWeHistoryResult> {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const now = input.now ?? (() => new Date());
	const accountName = input.accountName.trim();
	if (!accountName) {
		throw new Error("accountName is required.");
	}
	if (!Number.isInteger(input.maxPages) || input.maxPages < 1) {
		throw new Error("maxPages must be a positive integer.");
	}
	if (!Number.isInteger(input.maxArticles) || input.maxArticles < 1) {
		throw new Error("maxArticles must be a positive integer.");
	}
	const pageSize = input.size;
	if (!Number.isInteger(pageSize) || pageSize < 1) {
		throw new Error("size must be a positive integer.");
	}

	const accountSlug = input.accountSlug?.trim() || normalizeWeChatAccountSlug(accountName);
	let begin = input.begin?.trim() || "0";
	let articlesSeen = 0;
	let articlesMaterialized = 0;
	let pageCapturesFailed = 0;
	let pageCapturesSucceeded = 0;
	const artifacts: WeChatOfficialAccountCaptureArtifactRef[] = [];
	let planningOutcome: FeedWeCapturePlanningOutcome = "complete";

	for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
		const capturedAt = now().toISOString();
		const page = await fetchFeedWeHistoryPage({
			fetchImplementation,
			provider: input.provider,
			request: {
				begin,
				names: accountName,
				size: pageSize,
			},
		});
		articlesSeen += page.articles.length;
		const remainingBudget = input.maxArticles - articlesMaterialized;
		const pageArticles =
			remainingBudget > 0 ? page.articles.slice(0, Math.max(remainingBudget, 0)) : [];

		const stored = await writeFeedWePageArtifacts({
			accountName,
			accountSlug,
			artifactStore: input.artifactStore,
			capturedAt,
			fetchImplementation,
			now,
			page,
			pageArticles,
			providerBaseUrl: input.provider.baseUrl,
			request: {
				begin,
				names: accountName,
				size: pageSize,
			},
		});
		artifacts.push(...stored);
		articlesMaterialized += pageArticles.length;
		const pageFailures = stored.filter(
			(item) => item.artifactType === "page_fetch_metadata" && item.recordCount === 0,
		).length;
		pageCapturesFailed += pageFailures;
		pageCapturesSucceeded += pageArticles.length - pageFailures;

		if (articlesMaterialized >= input.maxArticles) {
			planningOutcome = "article_budget_exhausted";
			break;
		}
		if (!page.hasMore) {
			planningOutcome = "complete";
			break;
		}
		begin = nextBegin(page, begin, pageSize);
		if (pageIndex + 1 >= input.maxPages) {
			planningOutcome = "page_budget_exhausted";
		}
	}

	return {
		accountSlug,
		artifacts,
		planningOutcome,
		summary: {
			artifactUploads: artifacts.length,
			articlesMaterialized,
			articlesSeen,
			failures: pageCapturesFailed,
			pagesFetched: artifacts.filter((item) => item.artifactType === "provider_response").length,
			pageCaptureArtifacts: artifacts.filter((item) =>
				item.artifactType === "page_fetch_metadata" || item.artifactType === "page_raw_html",
			).length,
			pageCapturesFailed,
			pageCapturesSucceeded,
			sourceTruthArtifacts: artifacts.filter((item) =>
				item.artifactType.startsWith("source_truth_"),
			).length,
		},
	};
}

export function normalizeWeChatAccountSlug(value: string): string {
	const normalized = value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");
	if (normalized) {
		return normalized;
	}
	return `account_${sha256Hex(value).slice(0, 10)}`;
}

async function writeFeedWePageArtifacts(input: {
	accountName: string;
	accountSlug: string;
	artifactStore: WeChatOfficialAccountArtifactStore;
	capturedAt: string;
	fetchImplementation: typeof fetch;
	now: () => Date;
	page: FeedWeHistoryPage;
	pageArticles: unknown[];
	providerBaseUrl: string;
	request: {
		begin: string;
		names: string;
		size: number;
	};
}): Promise<WeChatOfficialAccountCaptureArtifactRef[]> {
	const providerData = textEncoder.encode(`${JSON.stringify(input.page.raw)}\n`);
	const rawVersionId = `raw_${sha256Hex(providerData).slice(0, 16)}`;
	const year = extractPageYear(input.page, input.capturedAt);
	const sourcePrefix = `wechat_official_account/${input.accountSlug}/${year}/${rawVersionId}`;
	const providerRef = await input.artifactStore.putObject({
		contentType: "application/x-ndjson",
		data: providerData,
		objectKey: `${sourcePrefix}/provider/feedwe/provider-response.jsonl`,
		recordCount: 1,
	});
	const summaryData = textEncoder.encode(
		`${JSON.stringify(
			{
				schemaVersion: "wechat_official_account_feedwe_request_summary.v1",
				accountName: input.accountName,
				accountSlug: input.accountSlug,
				articleCount: input.page.articles.length,
				articleProcessedCount: input.pageArticles.length,
				begin: input.request.begin,
				capturedAt: input.capturedAt,
				hasMore: input.page.hasMore,
				provider: "feedwe",
				providerBaseUrl: input.providerBaseUrl,
				rawVersionId,
				requestQuery: {
					begin: input.request.begin,
					names: input.request.names,
					size: input.request.size,
				},
				size: input.page.size,
				sourceChannel: "wechat_official_account",
				total: input.page.total,
			},
			null,
			2,
		)}\n`,
	);
	const summaryRef = await input.artifactStore.putObject({
		contentType: "application/json",
		data: summaryData,
		objectKey: `${sourcePrefix}/capture/feedwe-request-summary.json`,
		recordCount: 1,
	});
	const articleRefs: WeChatOfficialAccountCaptureArtifactRef[] = [];
	for (const article of input.pageArticles) {
		const pageCapture = await captureWeChatArticlePage({
			accountName: input.accountName,
			accountSlug: input.accountSlug,
			article,
			artifactStore: input.artifactStore,
			capturedAt: input.capturedAt,
			fetchImplementation: input.fetchImplementation,
			now: input.now,
		});
		articleRefs.push(...pageCapture);
	}

	return [
		{ ...providerRef, artifactType: "provider_response" },
		{ ...summaryRef, artifactType: "request_summary" },
		...articleRefs,
	];
}

async function captureWeChatArticlePage(input: {
	accountName: string;
	accountSlug: string;
	article: unknown;
	artifactStore: WeChatOfficialAccountArtifactStore;
	capturedAt: string;
	fetchImplementation: typeof fetch;
	now: () => Date;
}): Promise<WeChatOfficialAccountCaptureArtifactRef[]> {
	const articleRecord =
		input.article && typeof input.article === "object" && !Array.isArray(input.article)
			? (input.article as Record<string, unknown>)
			: {};
	const articleUrl = typeof articleRecord.url === "string" ? articleRecord.url.trim() : "";
	let page: CapturedWeChatOfficialAccountArticlePage;
	if (articleUrl) {
		page = await fetchWeChatOfficialAccountArticlePage({
			articleUrl,
			fetchImplementation: input.fetchImplementation,
			now: input.now,
		});
	} else {
		page = {
			bodyBlocks: [],
			contentType: null,
			coverImageUrl: null,
			fetchedAt: input.now().toISOString(),
			finalUrl: "",
			inlineImageUrls: [],
			parserVersion: "wechat-page-parser.v1",
			publishTime: null,
			publishTimeSource: null,
			rawHtml: null,
			statusCode: 0,
			summary: null,
			title: null,
		};
	}
	const material = buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage({
		accountName: input.accountName,
		accountSlug: input.accountSlug,
		article: input.article,
		capturedAt: input.capturedAt,
		page,
	});
	const captureRefs = await writeWeChatOfficialAccountArticleCaptureArtifacts({
		artifactStore: input.artifactStore,
		material,
		page,
	});
	const sourceTruthRefs = await writeWeChatOfficialAccountSourceTruthArtifacts({
		artifactStore: input.artifactStore,
		materials: [material],
	});
	return [...captureRefs, ...sourceTruthRefs];
}

async function writeWeChatOfficialAccountArticleCaptureArtifacts(input: {
	artifactStore: WeChatOfficialAccountArtifactStore;
	material: {
		accountName: string;
		accountSlug: string;
		articleStableId: string;
		rawAssetId: string;
		rawVersionId: string;
		year: string;
		manifest: {
			articleUrl: string | null;
			bodyState: string;
			providerArticleId: string | null;
		};
	};
	page: CapturedWeChatOfficialAccountArticlePage;
}): Promise<WeChatOfficialAccountCaptureArtifactRef[]> {
	const prefix = `wechat_official_account/${input.material.accountSlug}/${input.material.year}/${input.material.rawVersionId}`;
	const fetchMetadataData = textEncoder.encode(
		`${JSON.stringify(
			{
				schemaVersion: "wechat_official_account_article_fetch_metadata.v1",
				accountName: input.material.accountName,
				accountSlug: input.material.accountSlug,
				articleStableId: input.material.articleStableId,
				articleUrl: input.material.manifest.articleUrl,
				bodyState: input.material.manifest.bodyState,
				contentType: input.page.contentType,
				fetchedAt: input.page.fetchedAt,
				finalUrl: input.page.finalUrl,
				parserVersion: input.page.parserVersion,
				providerArticleId: input.material.manifest.providerArticleId,
				rawAssetId: input.material.rawAssetId,
				rawVersionId: input.material.rawVersionId,
				statusCode: input.page.statusCode,
			},
			null,
			2,
		)}\n`,
	);
	const fetchMetadataRef = await input.artifactStore.putObject({
		contentType: "application/json",
		data: fetchMetadataData,
		objectKey: `${prefix}/capture/wechat-article-fetch-metadata.json`,
		recordCount: input.page.statusCode >= 200 && input.page.statusCode < 300 ? 1 : 0,
	});
	const refs: WeChatOfficialAccountCaptureArtifactRef[] = [
		{ ...fetchMetadataRef, artifactType: "page_fetch_metadata" },
	];
	if (input.page.rawHtml?.trim()) {
		const pageHtmlRef = await input.artifactStore.putObject({
			contentType: "text/html; charset=utf-8",
			data: textEncoder.encode(input.page.rawHtml),
			objectKey: `${prefix}/capture/wechat-article-page.html`,
			recordCount: 1,
		});
		refs.push({ ...pageHtmlRef, artifactType: "page_raw_html" });
	}
	return refs;
}

function extractPageYear(page: FeedWeHistoryPage, capturedAt: string): string {
	for (const article of page.articles) {
		if (!article || typeof article !== "object" || Array.isArray(article)) {
			continue;
		}
		const record = article as Record<string, unknown>;
		const candidate =
			record.publishTime ??
			record.publish_time ??
			record.publishedAt ??
			record.published_at ??
			record.createTime ??
			record.created_at ??
			record.date;
		const year = extractYear(candidate);
		if (year) {
			return year;
		}
	}
	return extractYear(capturedAt) ?? new Date().getUTCFullYear().toString();
}

function extractYear(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const date = new Date(value > 10_000_000_000 ? value : value * 1000);
		return Number.isNaN(date.valueOf()) ? null : String(date.getUTCFullYear());
	}
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	const match = /(?<year>20\d{2}|19\d{2})/.exec(normalized);
	return match?.groups?.year ?? null;
}

function nextBegin(page: FeedWeHistoryPage, currentBegin: string, size: number): string {
	const parsed = Number.parseInt(page.begin || currentBegin, 10);
	if (Number.isFinite(parsed)) {
		return String(parsed + size);
	}
	return String(size);
}

function sha256Hex(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}
