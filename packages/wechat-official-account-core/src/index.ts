import { createHash } from "node:crypto";

export const WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL = "wechat_official_account" as const;
export const WECHAT_OFFICIAL_ACCOUNT_PROVIDER = "feedwe" as const;

export type WeChatArticleIdentityBasis = "article_url" | "provider_article_id";
export type WeChatArticleBodyState = "not_captured";
export type WeChatArticleAvailabilityState = "observed";
export type WeChatArticleBlockRole = "title" | "summary";
export type WeChatArticleMediaResourceRole = "cover_image";

export interface WeChatOfficialAccountArticleManifest {
	schemaVersion: "wechat_official_account_article_manifest.v1";
	sourceChannel: typeof WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL;
	accountName: string;
	accountSlug: string;
	articleStableId: string;
	rawAssetId: string;
	rawVersionId: string;
	articleUrl: string | null;
	normalizedArticleUrl: string | null;
	articleIdentityBasis: WeChatArticleIdentityBasis;
	provider: typeof WECHAT_OFFICIAL_ACCOUNT_PROVIDER;
	providerArticleId: string | null;
	capturedAt: string;
	titleRaw: string;
	titleNormalized: string;
	publishTime: string | null;
	publishTimeSource: string | null;
	coverImageUrl: string | null;
	bodyState: WeChatArticleBodyState;
	metadataHash: string;
	blockCount: number;
	mediaRefCount: number;
	availabilityState: WeChatArticleAvailabilityState;
}

export interface WeChatOfficialAccountContentBlockRow {
	schemaVersion: "wechat_official_account_content_block.v1";
	rawAssetId: string;
	rawVersionId: string;
	rowId: string;
	rowIndex: number;
	blockOrder: number;
	blockRole: WeChatArticleBlockRole;
	textRaw: string;
	textNormalized: string;
}

export interface WeChatOfficialAccountMediaRefRow {
	schemaVersion: "wechat_official_account_media_ref.v1";
	rawAssetId: string;
	rawVersionId: string;
	mediaRefId: string;
	refOrder: number;
	resourceRole: WeChatArticleMediaResourceRole;
	sourceUrl: string;
	normalizedSourceUrl: string;
}

export type WeChatOfficialAccountSourceTruthArtifactType =
	| "source_truth_article_manifest"
	| "source_truth_content_blocks"
	| "source_truth_media_refs";

export interface WeChatOfficialAccountSerializedArtifact {
	artifactType: WeChatOfficialAccountSourceTruthArtifactType;
	contentType: "application/json" | "application/x-ndjson";
	data: Uint8Array;
	objectKey: string;
	recordCount: number;
}

export interface WeChatOfficialAccountArticleSourceTruthMaterial {
	accountName: string;
	accountSlug: string;
	articleStableId: string;
	rawAssetId: string;
	rawVersionId: string;
	year: string;
	manifest: WeChatOfficialAccountArticleManifest;
	contentBlocks: WeChatOfficialAccountContentBlockRow[];
	mediaRefs: WeChatOfficialAccountMediaRefRow[];
	artifacts: WeChatOfficialAccountSerializedArtifact[];
}

export interface BuildWeChatOfficialAccountArticleSourceTruthInput {
	accountName: string;
	accountSlug: string;
	article: unknown;
	capturedAt: string;
}

export interface WeChatOfficialAccountSourceTruthValidationIssue {
	code: string;
	message: string;
}

const textEncoder = new TextEncoder();
const FORBIDDEN_SOURCE_TRUTH_KEYS = new Set([
	"document_id",
	"doc_id",
	"version_id",
	"revision_track",
	"chunk_id",
	"chunk_order",
	"embedding",
	"visibility_level",
	"visibility_scope",
	"entitlement_groups",
	"policy_projection_version",
]);

export function buildWeChatOfficialAccountArticleSourceTruthMaterial(
	input: BuildWeChatOfficialAccountArticleSourceTruthInput,
): WeChatOfficialAccountArticleSourceTruthMaterial {
	const article = normalizeArticleRecord(input.article);
	const accountName = firstText(article.accountName, input.accountName);
	const accountSlug = requireText(input.accountSlug, "accountSlug");
	const capturedAt = normalizeIsoTimestamp(input.capturedAt, "capturedAt");
	const titleRaw = requireText(article.title, "title");
	const titleNormalized = normalizeText(titleRaw);
	const providerArticleId = optionalText(article.id);
	const articleUrl = optionalText(article.url);
	const normalizedArticleUrl = articleUrl ? normalizeUrl(articleUrl) : null;
	if (!(normalizedArticleUrl || providerArticleId)) {
		throw new Error("article url or provider article id is required");
	}

	const articleIdentityBasis: WeChatArticleIdentityBasis = normalizedArticleUrl
		? "article_url"
		: "provider_article_id";
	const identityValue = normalizedArticleUrl ?? providerArticleId ?? "";
	const publish = normalizePublishTime(article);
	const coverImageUrl = optionalText(article.coverUrl);
	const normalizedCoverImageUrl = coverImageUrl ? normalizeUrl(coverImageUrl) : null;
	const articleStableId = prefixedHash("woa_article", `${accountSlug}\n${identityValue}`, 24);
	const rawAssetId = prefixedHash("woa_asset", `${accountSlug}\n${identityValue}`, 24);
	const metadataHash = hashJson({
		accountName,
		accountSlug,
		coverImageUrl: normalizedCoverImageUrl,
		normalizedArticleUrl,
		providerArticleId,
		publishTime: publish.value,
		titleNormalized,
	});
	const rawVersionId = prefixedHash("woa_ver", metadataHash, 24);
	const contentBlocks = [
		buildContentBlock({
			blockOrder: 0,
			blockRole: "title",
			rawAssetId,
			rawVersionId,
			rowIndex: 0,
			textRaw: titleRaw,
			textNormalized: titleNormalized,
		}),
	];
	const mediaRefs = normalizedCoverImageUrl
		? [
				buildMediaRef({
					normalizedSourceUrl: normalizedCoverImageUrl,
					rawAssetId,
					rawVersionId,
					refOrder: 0,
					sourceUrl: coverImageUrl ?? normalizedCoverImageUrl,
				}),
			]
		: [];
	const manifest: WeChatOfficialAccountArticleManifest = {
		schemaVersion: "wechat_official_account_article_manifest.v1",
		sourceChannel: WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL,
		accountName,
		accountSlug,
		articleStableId,
		rawAssetId,
		rawVersionId,
		articleUrl,
		normalizedArticleUrl,
		articleIdentityBasis,
		provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
		providerArticleId,
		capturedAt,
		titleRaw,
		titleNormalized,
		publishTime: publish.value,
		publishTimeSource: publish.source,
		coverImageUrl: normalizedCoverImageUrl,
		bodyState: "not_captured",
		metadataHash,
		blockCount: contentBlocks.length,
		mediaRefCount: mediaRefs.length,
		availabilityState: "observed",
	};
	const year = extractYear(publish.value) ?? extractYear(capturedAt) ?? "undated";
	return {
		accountName,
		accountSlug,
		articleStableId,
		rawAssetId,
		rawVersionId,
		year,
		manifest,
		contentBlocks,
		mediaRefs,
		artifacts: serializeWeChatOfficialAccountArticleSourceTruthArtifacts({
			accountSlug,
			contentBlocks,
			manifest,
			mediaRefs,
			rawVersionId,
			year,
		}),
	};
}

export function buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWePage(input: {
	accountName: string;
	accountSlug: string;
	capturedAt: string;
	page: { articles: unknown[] } | { raw: { articles?: unknown } };
}): WeChatOfficialAccountArticleSourceTruthMaterial[] {
	const rawArticles =
		"articles" in input.page && Array.isArray(input.page.articles)
			? input.page.articles
			: "raw" in input.page && Array.isArray(input.page.raw.articles)
				? input.page.raw.articles
				: [];
	return rawArticles.map((article) =>
		buildWeChatOfficialAccountArticleSourceTruthMaterial({
			accountName: input.accountName,
			accountSlug: input.accountSlug,
			article,
			capturedAt: input.capturedAt,
		}),
	);
}

export function buildWeChatOfficialAccountSourceTruthArtifactKey(input: {
	accountSlug: string;
	year: string;
	rawVersionId: string;
	filename: "article-manifest.json" | "content-blocks.jsonl" | "media-refs.jsonl";
}): string {
	return [
		WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL,
		validatePathSegment(input.accountSlug, "accountSlug"),
		validatePathSegment(input.year, "year"),
		validatePathSegment(input.rawVersionId, "rawVersionId"),
		"source-truth",
		validateFilename(input.filename),
	].join("/");
}

export function validateWeChatOfficialAccountArticleSourceTruth(
	material: WeChatOfficialAccountArticleSourceTruthMaterial,
): WeChatOfficialAccountSourceTruthValidationIssue[] {
	const issues: WeChatOfficialAccountSourceTruthValidationIssue[] = [];
	if (material.manifest.schemaVersion !== "wechat_official_account_article_manifest.v1") {
		issues.push({ code: "invalid_schema", message: "article manifest schemaVersion is invalid" });
	}
	if (material.manifest.sourceChannel !== WECHAT_OFFICIAL_ACCOUNT_SOURCE_CHANNEL) {
		issues.push({ code: "invalid_source_channel", message: "sourceChannel is invalid" });
	}
	if (material.manifest.bodyState !== "not_captured") {
		issues.push({ code: "body_captured", message: "Phase 3 source-truth must not carry body" });
	}
	if (material.manifest.blockCount !== material.contentBlocks.length) {
		issues.push({ code: "block_count_mismatch", message: "blockCount does not match blocks" });
	}
	if (material.manifest.mediaRefCount !== material.mediaRefs.length) {
		issues.push({
			code: "media_count_mismatch",
			message: "mediaRefCount does not match media refs",
		});
	}
	for (const key of findForbiddenKeys(material)) {
		issues.push({
			code: "forbidden_field",
			message: `source-truth must not contain forbidden field ${key}`,
		});
	}
	return issues;
}

function serializeWeChatOfficialAccountArticleSourceTruthArtifacts(input: {
	accountSlug: string;
	contentBlocks: WeChatOfficialAccountContentBlockRow[];
	manifest: WeChatOfficialAccountArticleManifest;
	mediaRefs: WeChatOfficialAccountMediaRefRow[];
	rawVersionId: string;
	year: string;
}): WeChatOfficialAccountSerializedArtifact[] {
	return [
		{
			artifactType: "source_truth_article_manifest",
			contentType: "application/json",
			data: encodeJson(input.manifest),
			objectKey: buildWeChatOfficialAccountSourceTruthArtifactKey({
				accountSlug: input.accountSlug,
				filename: "article-manifest.json",
				rawVersionId: input.rawVersionId,
				year: input.year,
			}),
			recordCount: 1,
		},
		{
			artifactType: "source_truth_content_blocks",
			contentType: "application/x-ndjson",
			data: encodeJsonl(input.contentBlocks),
			objectKey: buildWeChatOfficialAccountSourceTruthArtifactKey({
				accountSlug: input.accountSlug,
				filename: "content-blocks.jsonl",
				rawVersionId: input.rawVersionId,
				year: input.year,
			}),
			recordCount: input.contentBlocks.length,
		},
		{
			artifactType: "source_truth_media_refs",
			contentType: "application/x-ndjson",
			data: encodeJsonl(input.mediaRefs),
			objectKey: buildWeChatOfficialAccountSourceTruthArtifactKey({
				accountSlug: input.accountSlug,
				filename: "media-refs.jsonl",
				rawVersionId: input.rawVersionId,
				year: input.year,
			}),
			recordCount: input.mediaRefs.length,
		},
	];
}

function buildContentBlock(input: {
	blockOrder: number;
	blockRole: WeChatArticleBlockRole;
	rawAssetId: string;
	rawVersionId: string;
	rowIndex: number;
	textRaw: string;
	textNormalized: string;
}): WeChatOfficialAccountContentBlockRow {
	return {
		schemaVersion: "wechat_official_account_content_block.v1",
		rawAssetId: input.rawAssetId,
		rawVersionId: input.rawVersionId,
		rowId: prefixedHash(
			"woa_block",
			`${input.rawAssetId}\n${input.rawVersionId}\n${input.rowIndex}\n${input.blockRole}`,
			24,
		),
		rowIndex: input.rowIndex,
		blockOrder: input.blockOrder,
		blockRole: input.blockRole,
		textRaw: input.textRaw,
		textNormalized: input.textNormalized,
	};
}

function buildMediaRef(input: {
	normalizedSourceUrl: string;
	rawAssetId: string;
	rawVersionId: string;
	refOrder: number;
	sourceUrl: string;
}): WeChatOfficialAccountMediaRefRow {
	return {
		schemaVersion: "wechat_official_account_media_ref.v1",
		rawAssetId: input.rawAssetId,
		rawVersionId: input.rawVersionId,
		mediaRefId: prefixedHash(
			"woa_media",
			`${input.rawAssetId}\n${input.rawVersionId}\n${input.refOrder}\n${input.normalizedSourceUrl}`,
			24,
		),
		refOrder: input.refOrder,
		resourceRole: "cover_image",
		sourceUrl: input.sourceUrl,
		normalizedSourceUrl: input.normalizedSourceUrl,
	};
}

function normalizeArticleRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("article must be an object");
	}
	return value as Record<string, unknown>;
}

function normalizePublishTime(article: Record<string, unknown>): {
	source: string | null;
	value: string | null;
} {
	for (const key of ["publishDate", "publishTime", "publish_time", "publishedAt", "published_at"]) {
		const value = optionalText(article[key]);
		if (!value) {
			continue;
		}
		const parsed = parseDateTime(value);
		if (parsed) {
			return { source: key, value: parsed };
		}
	}
	return { source: null, value: null };
}

function parseDateTime(value: string): string | null {
	const normalized = value.trim();
	const localMatch =
		/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/.exec(
			normalized,
		);
	if (localMatch?.groups) {
		const { day, hour, minute, month, second = "00", year } = localMatch.groups;
		const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
		return Number.isNaN(date.valueOf()) ? null : date.toISOString();
	}
	const date = new Date(normalized);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function extractYear(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const match = /(?<year>19\d{2}|20\d{2})/.exec(value);
	return match?.groups?.year ?? null;
}

function normalizeUrl(value: string): string {
	const parsed = new URL(value.trim());
	parsed.hash = "";
	return parsed.toString();
}

function firstText(...values: unknown[]): string {
	for (const value of values) {
		const normalized = optionalText(value);
		if (normalized) {
			return normalized;
		}
	}
	return "";
}

function requireText(value: unknown, field: string): string {
	const normalized = optionalText(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

function optionalText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeIsoTimestamp(value: string, field: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		throw new Error(`${field} must be a valid ISO timestamp`);
	}
	return date.toISOString();
}

function hashJson(value: Record<string, unknown>): string {
	return sha256Hex(JSON.stringify(value));
}

function prefixedHash(prefix: string, value: string, length: number): string {
	return `${prefix}_${sha256Hex(value).slice(0, length)}`;
}

function sha256Hex(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function encodeJson(value: unknown): Uint8Array {
	return textEncoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function encodeJsonl(rows: unknown[]): Uint8Array {
	return textEncoder.encode(
		rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
	);
}

function validatePathSegment(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized || normalized.includes("/")) {
		throw new Error(`${field} must be a non-empty path segment`);
	}
	return normalized;
}

function validateFilename(value: string): string {
	if (!value || value.includes("/")) {
		throw new Error("filename must be a basename");
	}
	return value;
}

function findForbiddenKeys(value: unknown): string[] {
	const found = new Set<string>();
	visitForbiddenKeys(value, found);
	return [...found].sort();
}

function visitForbiddenKeys(value: unknown, found: Set<string>): void {
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			visitForbiddenKeys(item, found);
		}
		return;
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_SOURCE_TRUTH_KEYS.has(key)) {
			found.add(key);
		}
		visitForbiddenKeys(nested, found);
	}
}
