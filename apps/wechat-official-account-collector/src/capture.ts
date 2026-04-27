import { createHash } from "node:crypto";
import { buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWePage } from "wechat-official-account-core";

import type { StoredArtifactRef, WeChatOfficialAccountArtifactStore } from "./artifact-store.ts";
import {
	type FeedWeHistoryPage,
	type FeedWeProviderConfig,
	fetchFeedWeHistoryPage,
} from "./feedwe-client.ts";
import { writeWeChatOfficialAccountSourceTruthArtifacts } from "./replay-source-truth.ts";

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
		articlesMaterialized += page.articles.length;

		const stored = await writeFeedWePageArtifacts({
			accountName,
			accountSlug,
			artifactStore: input.artifactStore,
			capturedAt,
			page,
			providerBaseUrl: input.provider.baseUrl,
			request: {
				begin,
				names: accountName,
				size: pageSize,
			},
		});
		artifacts.push(...stored);

		if (articlesSeen >= input.maxArticles) {
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
			failures: 0,
			pagesFetched: artifacts.filter((item) => item.artifactType === "provider_response").length,
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
	page: FeedWeHistoryPage;
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
	const sourceTruthMaterials = buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWePage({
		accountName: input.accountName,
		accountSlug: input.accountSlug,
		capturedAt: input.capturedAt,
		page: input.page,
	});
	const sourceTruthRefs = await writeWeChatOfficialAccountSourceTruthArtifacts({
		artifactStore: input.artifactStore,
		materials: sourceTruthMaterials,
	});

	return [
		{ ...providerRef, artifactType: "provider_response" },
		{ ...summaryRef, artifactType: "request_summary" },
		...sourceTruthRefs,
	];
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
