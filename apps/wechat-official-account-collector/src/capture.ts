import { createHash } from "node:crypto";
import {
	buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage,
	type CapturedWeChatOfficialAccountArticleMedia,
	type CapturedWeChatOfficialAccountArticlePage,
	type WeChatOfficialAccountArticleSourceTruthMaterial,
} from "wechat-official-account-core";

import type { StoredArtifactRef, WeChatOfficialAccountArtifactStore } from "./artifact-store.ts";
import {
	type FeedWeArticlesPage,
	type FeedWeAuthMe,
	type FeedWeProviderConfig,
	type FeedWeSubscription,
	fetchFeedWeArticlesPage,
	fetchFeedWeAuthMe,
	fetchFeedWeSubscriptions,
	loginFeedWe,
	resolveFeedWeSubscription,
} from "./feedwe-client.ts";
import {
	fetchWeChatOfficialAccountArticlePage,
	WECHAT_ARTICLE_PAGE_PARSER_VERSION,
} from "./wechat-article-page.ts";

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
		| "page_extraction"
		| "captured_media_metadata"
		| "captured_media_object"
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
		bodyCapturedArticles: number;
		bodyMissingArticles: number;
		failures: number;
		mediaCaptureArtifacts: number;
		mediaCapturedCount: number;
		mediaCaptureFailedCount: number;
		mediaReferenceCount: number;
		pagesFetched: number;
		pageCaptureArtifacts: number;
		pageCapturesFailed: number;
		pageCapturesSucceeded: number;
		sourceTruthArtifacts: number;
	};
}

const textEncoder = new TextEncoder();
const MIME_TYPE_EXTENSION: Record<string, string> = {
	"image/gif": ".gif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
};

interface CapturedArticleMediaPayload extends CapturedWeChatOfficialAccountArticleMedia {
	contentType: string | null;
	imageBytes: Uint8Array | null;
	objectKeySeed: string;
}

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
	const session = await loginFeedWe({
		fetchImplementation,
		provider: input.provider,
	});
	const authMe = await fetchFeedWeAuthMe({
		fetchImplementation,
		provider: input.provider,
		token: session.token,
	});
	const subscriptions = await fetchFeedWeSubscriptions({
		fetchImplementation,
		provider: input.provider,
		token: session.token,
	});
	const subscription = resolveFeedWeSubscription({
		accountName,
		accountSlug,
		subscriptions,
	});

	let cursor = input.begin?.trim() || null;
	let articlesSeen = 0;
	let articlesMaterialized = 0;
	let bodyCapturedArticles = 0;
	let bodyMissingArticles = 0;
	let mediaCaptureArtifacts = 0;
	let mediaCapturedCount = 0;
	let mediaCaptureFailedCount = 0;
	let mediaReferenceCount = 0;
	let pageCaptureArtifacts = 0;
	let pageCapturesFailed = 0;
	let pageCapturesSucceeded = 0;
	const artifacts: WeChatOfficialAccountCaptureArtifactRef[] = [];
	let planningOutcome: FeedWeCapturePlanningOutcome = "complete";

	for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
		const capturedAt = now().toISOString();
		const page = await fetchFeedWeArticlesPage({
			fetchImplementation,
			provider: input.provider,
			request: {
				accountId: subscription.wechatAccountId,
				cursor,
				limit: pageSize,
			},
			token: session.token,
		});
		articlesSeen += page.articles.length;
		const remainingBudget = input.maxArticles - articlesMaterialized;
		const pageArticles =
			remainingBudget > 0 ? page.articles.slice(0, Math.max(remainingBudget, 0)) : [];
		const pageMaterials: WeChatOfficialAccountArticleSourceTruthMaterial[] = [];
		const pageCaptureRefs: WeChatOfficialAccountCaptureArtifactRef[] = [];
		for (const article of pageArticles) {
			const capturedPage = await captureWeChatArticlePage({
				article,
				fetchImplementation,
				now,
			});
			const capturedMedia = await captureWeChatArticleMedia({
				articleSourceUrl: capturedPage.finalUrl || resolveArticleUrl(article) || "",
				coverImageUrl: capturedPage.coverImageUrl,
				fetchImplementation,
				inlineImageUrls: capturedPage.inlineImageUrls,
				now,
			});
			const provisionalMaterial =
				buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage({
					accountName,
					accountSlug,
					article,
					capturedAt,
					page: capturedPage,
					mediaCaptures: capturedMedia,
				});
			const mediaCaptureResult = await writeWeChatArticlePageCaptureArtifacts({
				article,
				artifactStore: input.artifactStore,
				capturedAt,
				material: provisionalMaterial,
				mediaCaptures: capturedMedia,
				page: capturedPage,
			});
			const material = buildWeChatOfficialAccountArticleSourceTruthMaterialFromCapturedPage({
				accountName,
				accountSlug,
				article,
				capturedAt,
				page: capturedPage,
				mediaCaptures: mediaCaptureResult.mediaCaptures,
			});
			pageMaterials.push(material);
			pageCaptureRefs.push(...mediaCaptureResult.refs);
			pageCaptureArtifacts += mediaCaptureResult.refs.length;
			mediaCaptureArtifacts += mediaCaptureResult.mediaArtifactCount;
			mediaCapturedCount += mediaCaptureResult.mediaCaptures.filter(
				(item) => item.captureStatus === "captured",
			).length;
			mediaCaptureFailedCount += mediaCaptureResult.mediaCaptures.filter(
				(item) => item.captureStatus === "fetch_failed",
			).length;
			mediaReferenceCount += mediaCaptureResult.mediaCaptures.length;
			if (isSuccessfulPageCapture(capturedPage)) {
				pageCapturesSucceeded += 1;
			} else {
				pageCapturesFailed += 1;
			}
		}
		bodyCapturedArticles += pageMaterials.filter(
			(material) => material.manifest.bodyState === "captured",
		).length;
		bodyMissingArticles += pageMaterials.filter(
			(material) => material.manifest.bodyState !== "captured",
		).length;

		const stored = await writeFeedWePageArtifacts({
			accountName,
			accountSlug,
			artifactStore: input.artifactStore,
			authMe,
			capturedAt,
			page,
			pageArticles,
			pageMaterials,
			providerBaseUrl: input.provider.baseUrl,
			request: {
				accountId: subscription.wechatAccountId,
				cursor,
				limit: pageSize,
			},
			session,
			subscription,
		});
		artifacts.push(...stored, ...pageCaptureRefs);
		articlesMaterialized += pageArticles.length;

		if (articlesMaterialized >= input.maxArticles) {
			planningOutcome = "article_budget_exhausted";
			break;
		}
		if (!page.pagination.hasMore) {
			planningOutcome = "complete";
			break;
		}
		cursor = page.pagination.nextCursor;
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
			bodyCapturedArticles,
			bodyMissingArticles,
			failures: pageCapturesFailed,
			mediaCaptureArtifacts,
			mediaCapturedCount,
			mediaCaptureFailedCount,
			mediaReferenceCount,
			pagesFetched: artifacts.filter((item) => item.artifactType === "provider_response").length,
			pageCaptureArtifacts,
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

async function captureWeChatArticlePage(input: {
	article: unknown;
	fetchImplementation: typeof fetch;
	now: () => Date;
}): Promise<CapturedWeChatOfficialAccountArticlePage> {
	const articleUrl = resolveArticleUrl(input.article);
	if (!articleUrl) {
		return buildSyntheticFetchErrorPage({
			articleUrl: "",
			fetchedAt: input.now().toISOString(),
			message: "article url is required",
		});
	}
	try {
		return await fetchWeChatOfficialAccountArticlePage({
			articleUrl,
			fetchImplementation: input.fetchImplementation,
			now: input.now,
		});
	} catch (error) {
		return buildSyntheticFetchErrorPage({
			articleUrl,
			fetchedAt: input.now().toISOString(),
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

async function captureWeChatArticleMedia(input: {
	articleSourceUrl: string;
	coverImageUrl: string | null;
	fetchImplementation: typeof fetch;
	inlineImageUrls: string[];
	now: () => Date;
}): Promise<CapturedArticleMediaPayload[]> {
	const orderedUrls: Array<{ normalizedSourceUrl: string; sourceUrl: string }> = [];
	const seen = new Set<string>();
	for (const candidate of [input.coverImageUrl, ...input.inlineImageUrls]) {
		const sourceUrl = normalizeMediaUrl(candidate);
		if (!sourceUrl || seen.has(sourceUrl)) {
			continue;
		}
		seen.add(sourceUrl);
		orderedUrls.push({
			normalizedSourceUrl: sourceUrl,
			sourceUrl,
		});
	}
	const media: CapturedArticleMediaPayload[] = [];
	for (const item of orderedUrls) {
		const capturedAt = input.now().toISOString();
		try {
			const response = await input.fetchImplementation(item.sourceUrl, {
				headers: {
					accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
					"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
					referer: input.articleSourceUrl,
					"user-agent":
						"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
				},
				redirect: "follow",
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const contentType = normalizeImageContentType(response.headers.get("content-type"));
			if (!contentType) {
				throw new Error("non-image content-type");
			}
			const imageBytes = new Uint8Array(await response.arrayBuffer());
			const finalUrl = normalizeMediaUrl(response.url) ?? item.normalizedSourceUrl;
			media.push({
				byteSize: imageBytes.byteLength,
				captureStatus: "captured",
				capturedAt,
				contentSha256: sha256Hex(imageBytes),
				contentType,
				finalUrl,
				fetchErrorMessage: null,
				imageBytes,
				mimeType: contentType,
				normalizedSourceUrl: item.normalizedSourceUrl,
				objectKey: null,
				objectKeySeed: sha256Hex(item.normalizedSourceUrl).slice(0, 16),
				sourceUrl: item.sourceUrl,
			});
		} catch (error) {
			media.push({
				byteSize: null,
				captureStatus: "fetch_failed",
				capturedAt,
				contentSha256: null,
				contentType: null,
				finalUrl: null,
				fetchErrorMessage: error instanceof Error ? error.message : String(error),
				imageBytes: null,
				mimeType: null,
				normalizedSourceUrl: item.normalizedSourceUrl,
				objectKey: null,
				objectKeySeed: sha256Hex(item.normalizedSourceUrl).slice(0, 16),
				sourceUrl: item.sourceUrl,
			});
		}
	}
	return media;
}

async function writeWeChatArticlePageCaptureArtifacts(input: {
	article: unknown;
	artifactStore: WeChatOfficialAccountArtifactStore;
	capturedAt: string;
	material: WeChatOfficialAccountArticleSourceTruthMaterial;
	mediaCaptures: CapturedArticleMediaPayload[];
	page: CapturedWeChatOfficialAccountArticlePage;
}): Promise<{
	refs: WeChatOfficialAccountCaptureArtifactRef[];
	mediaArtifactCount: number;
	mediaCaptures: CapturedWeChatOfficialAccountArticleMedia[];
}> {
	const articlePrefix = buildArticlePrefix(input.material);
	const capturePrefix = buildArticleCapturePrefix(input.material);
	const metadata = {
		schemaVersion: "wechat_official_account_article_fetch_metadata.v1",
		accountSlug: input.material.accountSlug,
		accountName: input.material.accountName,
		articleStableId: input.material.articleStableId,
		rawAssetId: input.material.rawAssetId,
		rawVersionId: input.material.rawVersionId,
		providerArticleId: resolveArticleProviderId(input.article),
		articleUrl: resolveArticleUrl(input.article),
		capturedAt: input.capturedAt,
		fetchedAt: input.page.fetchedAt,
		finalUrl: input.page.finalUrl,
		statusCode: input.page.statusCode,
		contentType: input.page.contentType,
		parserVersion: input.page.parserVersion,
		pageKind: input.page.pageKind,
		bodyState: input.material.manifest.bodyState,
		title: input.page.title,
		summary: input.page.summary,
		publishTime: input.page.publishTime,
		publishTimeSource: input.page.publishTimeSource,
		coverImageUrl: input.page.coverImageUrl,
		bodyBlockCount: input.page.bodyBlocks.length,
		inlineImageCount: input.page.inlineImageUrls.length,
		rawHtmlCaptured: Boolean(input.page.rawHtml),
		fetchErrorMessage: input.page.fetchErrorMessage ?? null,
	};
	const metadataRef = await input.artifactStore.putObject({
		contentType: "application/json",
		data: textEncoder.encode(`${JSON.stringify(metadata, null, 2)}\n`),
		objectKey: `${capturePrefix}/wechat-article-fetch-metadata.json`,
		recordCount: 1,
	});
	const refs: WeChatOfficialAccountCaptureArtifactRef[] = [
		{ ...metadataRef, artifactType: "page_fetch_metadata" },
	];
	if (input.page.rawHtml) {
		const pageRef = await input.artifactStore.putObject({
			contentType: input.page.contentType ?? "text/html; charset=utf-8",
			data: textEncoder.encode(input.page.rawHtml),
			objectKey: `${capturePrefix}/wechat-article-page.html`,
			recordCount: 1,
		});
		refs.push({ ...pageRef, artifactType: "page_raw_html" });
	}
	const extractionRef = await input.artifactStore.putObject({
		contentType: "application/json",
		data: textEncoder.encode(
			`${JSON.stringify(
				{
					schemaVersion: "wechat_official_account_article_page_extraction.v1",
					accountName: input.material.accountName,
					accountSlug: input.material.accountSlug,
					articleStableId: input.material.articleStableId,
					rawAssetId: input.material.rawAssetId,
					rawVersionId: input.material.rawVersionId,
					parserVersion: input.page.parserVersion,
					pageKind: input.page.pageKind,
					finalUrl: input.page.finalUrl,
					title: input.page.title,
					summary: input.page.summary,
					publishTime: input.page.publishTime,
					publishTimeSource: input.page.publishTimeSource,
					coverImageUrl: input.page.coverImageUrl,
					bodyBlocks: input.page.bodyBlocks,
					inlineImageUrls: input.page.inlineImageUrls,
				},
				null,
				2,
			)}\n`,
		),
		objectKey: `${articlePrefix}/provider/wechat-page-parser/page-extraction.json`,
		recordCount: 1,
	});
	refs.push({ ...extractionRef, artifactType: "page_extraction" });

	const finalizedMediaCaptures: CapturedWeChatOfficialAccountArticleMedia[] = [];
	let mediaArtifactCount = 0;
	for (const media of input.mediaCaptures) {
		const mediaPrefix = `${capturePrefix}/media/${media.objectKeySeed}`;
		let objectKey: string | null = null;
		if (media.captureStatus === "captured" && media.imageBytes && media.contentType) {
			objectKey = `${mediaPrefix}/original${inferImageExtension({
				contentType: media.contentType,
				sourceUrl: media.finalUrl ?? media.normalizedSourceUrl,
			})}`;
			const storedObject = await input.artifactStore.putObject({
				contentType: media.contentType,
				data: media.imageBytes,
				objectKey,
			});
			refs.push({ ...storedObject, artifactType: "captured_media_object" });
			mediaArtifactCount += 1;
		}
		const metadataObject = {
			schemaVersion: "wechat_official_account_media_fetch_metadata.v1",
			accountName: input.material.accountName,
			accountSlug: input.material.accountSlug,
			articleStableId: input.material.articleStableId,
			rawAssetId: input.material.rawAssetId,
			rawVersionId: input.material.rawVersionId,
			sourceUrl: media.sourceUrl,
			normalizedSourceUrl: media.normalizedSourceUrl,
			captureStatus: media.captureStatus,
			finalUrl: media.finalUrl,
			objectKey,
			contentSha256: media.contentSha256,
			mimeType: media.mimeType,
			byteSize: media.byteSize,
			capturedAt: media.capturedAt,
			fetchErrorMessage: media.fetchErrorMessage,
		};
		const storedMetadata = await input.artifactStore.putObject({
			contentType: "application/json",
			data: textEncoder.encode(`${JSON.stringify(metadataObject, null, 2)}\n`),
			objectKey: `${mediaPrefix}/fetch-metadata.json`,
			recordCount: 1,
		});
		refs.push({ ...storedMetadata, artifactType: "captured_media_metadata" });
		mediaArtifactCount += 1;
		finalizedMediaCaptures.push({
			byteSize: media.byteSize,
			captureStatus: media.captureStatus,
			capturedAt: media.capturedAt,
			contentSha256: media.contentSha256,
			finalUrl: media.finalUrl,
			fetchErrorMessage: media.fetchErrorMessage,
			mimeType: media.mimeType,
			normalizedSourceUrl: media.normalizedSourceUrl,
			objectKey,
			sourceUrl: media.sourceUrl,
		});
	}
	return { refs, mediaArtifactCount, mediaCaptures: finalizedMediaCaptures };
}

async function writeFeedWePageArtifacts(input: {
	accountName: string;
	accountSlug: string;
	artifactStore: WeChatOfficialAccountArtifactStore;
	authMe: FeedWeAuthMe;
	capturedAt: string;
	page: FeedWeArticlesPage;
	pageArticles: unknown[];
	pageMaterials: WeChatOfficialAccountArticleSourceTruthMaterial[];
	providerBaseUrl: string;
	request: {
		accountId: string;
		cursor: string | null;
		limit: number;
	};
	session: {
		token: string;
		user: { email: string | null; id: string | null };
	};
	subscription: FeedWeSubscription;
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
				schemaVersion: "wechat_official_account_feedwe_request_summary.v2",
				accountName: input.accountName,
				accountSlug: input.accountSlug,
				articleCount: input.page.articles.length,
				articleProcessedCount: input.pageArticles.length,
				authenticatedUser: {
					email: input.authMe.user.email ?? input.session.user.email,
					id: input.authMe.user.id ?? input.session.user.id,
					isActive: input.authMe.user.isActive,
					subscriptionCount: input.authMe.user.subscriptionCount,
				},
				capturedAt: input.capturedAt,
				pagination: {
					hasMore: input.page.pagination.hasMore,
					nextCursor: input.page.pagination.nextCursor,
					total: input.page.pagination.total,
				},
				provider: "feedwe",
				providerBaseUrl: input.providerBaseUrl,
				rawVersionId,
				requestQuery: {
					accountId: input.request.accountId,
					cursor: input.request.cursor,
					limit: input.request.limit,
				},
				selectedSubscription: {
					accountAlias: input.subscription.wechatAccount.alias,
					accountId: input.subscription.wechatAccountId,
					accountName: input.subscription.wechatAccount.name,
					subscriptionId: input.subscription.id,
				},
				sourceChannel: "wechat_official_account",
				sourceTruthBodySummary: {
					captured: input.pageMaterials.filter(
						(material) => material.manifest.bodyState === "captured",
					).length,
					missing: input.pageMaterials.filter(
						(material) => material.manifest.bodyState !== "captured",
					).length,
				},
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
	const sourceTruthRefs = await writeWeChatOfficialAccountSourceTruthArtifacts({
		artifactStore: input.artifactStore,
		materials: input.pageMaterials,
	});
	return [
		{ ...providerRef, artifactType: "provider_response" },
		{ ...summaryRef, artifactType: "request_summary" },
		...sourceTruthRefs,
	];
}

async function writeWeChatOfficialAccountSourceTruthArtifacts(input: {
	artifactStore: WeChatOfficialAccountArtifactStore;
	materials: WeChatOfficialAccountArticleSourceTruthMaterial[];
}): Promise<WeChatOfficialAccountCaptureArtifactRef[]> {
	const refs: WeChatOfficialAccountCaptureArtifactRef[] = [];
	for (const material of input.materials) {
		for (const artifact of material.artifacts) {
			const stored = await input.artifactStore.putObject({
				contentType: artifact.contentType,
				data: artifact.data,
				objectKey: artifact.objectKey,
				recordCount: artifact.recordCount,
			});
			refs.push({
				...stored,
				artifactType: artifact.artifactType,
			});
		}
	}
	return refs;
}

function buildArticlePrefix(material: WeChatOfficialAccountArticleSourceTruthMaterial): string {
	return `wechat_official_account/${material.accountSlug}/${material.year}/${material.rawVersionId}`;
}

function buildArticleCapturePrefix(
	material: WeChatOfficialAccountArticleSourceTruthMaterial,
): string {
	return `${buildArticlePrefix(material)}/capture`;
}

function buildSyntheticFetchErrorPage(input: {
	articleUrl: string;
	fetchedAt: string;
	message: string;
}): CapturedWeChatOfficialAccountArticlePage {
	return {
		bodyBlocks: [],
		contentType: null,
		coverImageUrl: null,
		fetchErrorMessage: input.message,
		fetchedAt: input.fetchedAt,
		finalUrl: input.articleUrl,
		inlineImageUrls: [],
		pageKind: "fetch_error",
		parserVersion: WECHAT_ARTICLE_PAGE_PARSER_VERSION,
		publishTime: null,
		publishTimeSource: null,
		rawHtml: null,
		statusCode: 0,
		summary: null,
		title: null,
	};
}

function isSuccessfulPageCapture(page: CapturedWeChatOfficialAccountArticlePage): boolean {
	return page.pageKind === "article" && page.statusCode >= 200 && page.statusCode < 300;
}

function resolveArticleRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function resolveArticleUrl(value: unknown): string | null {
	const article = resolveArticleRecord(value);
	return typeof article.url === "string" && article.url.trim() ? article.url.trim() : null;
}

function resolveArticleProviderId(value: unknown): string | null {
	const article = resolveArticleRecord(value);
	return typeof article.id === "string" && article.id.trim() ? article.id.trim() : null;
}

function normalizeMediaUrl(value: string | null | undefined): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		const parsed = new URL(value.trim());
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return null;
	}
}

function normalizeImageContentType(value: string | null): string | null {
	const normalized = String(value || "")
		.split(";", 1)[0]
		.trim()
		.toLowerCase();
	return normalized.startsWith("image/") ? normalized : null;
}

function inferImageExtension(input: { contentType: string; sourceUrl: string }): string {
	const direct = MIME_TYPE_EXTENSION[input.contentType];
	if (direct) {
		return direct;
	}
	const match = /\.([a-z0-9]{1,8})(?:$|[?#])/i.exec(input.sourceUrl);
	return match ? `.${match[1]!.toLowerCase()}` : ".bin";
}

function extractPageYear(page: FeedWeArticlesPage, capturedAt: string): string {
	for (const article of page.articles) {
		if (!article || typeof article !== "object" || Array.isArray(article)) {
			continue;
		}
		const record = article as Record<string, unknown>;
		const candidate =
			record.publishDate ??
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

function sha256Hex(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}
