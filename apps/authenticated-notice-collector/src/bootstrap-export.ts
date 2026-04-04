import fs from "node:fs";
import path from "node:path";

import { fetchNoticeDetail, fetchNoticePage } from "./api";
import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config";
import { buildNoticeTypePolicySnapshot, getEnabledNoticeTypes, loadNoticeTypes } from "./notice-types";
import { createApiContextFromStorageState } from "./portal";
import type {
  ApiRequestContextLike,
  BundleAttachmentObservation,
  BundleLinkObservation,
  BundleNoticeAttachmentRelation,
  BootstrapExportManifest,
  BundleNoticePayload,
  BundleNoticeRecord,
  CollectorExportMetadata,
  DisposableApiContextLike,
  NoticeCategoryRecord,
  NoticeDetailInfo,
  NoticeDetailResponse,
  NoticeItem,
  NoticeListResponse,
  NoticeTypeConfig,
} from "./types";

const AUTHENTICATED_NOTICE_SOURCE_CHANNEL = "authenticated_notice_portal";
const EXPORT_SCHEMA_VERSION = "authenticated_notice_collector_export_v2";
const COLLECTOR_EXPORT_METADATA: CollectorExportMetadata = {
  runtime_shell: "repo_local_node",
  export_contract_version: EXPORT_SCHEMA_VERSION,
  link_collection_mode: "html_reference_only",
  attachment_collection_mode: "html_reference_only",
  attachment_storage_mode: "reference_only",
};
const HTML_ANCHOR_RE = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;
const HTML_TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const ATTACHMENT_FILE_EXTENSIONS = new Set([
  ".7z",
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".txt",
  ".xls",
  ".xlsx",
  ".zip",
]);

export interface CollectBootstrapBundleInput {
  createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
  exportedAt: string;
  fetchNoticeDetail?: (input: {
    apiContext: ApiRequestContextLike;
    noticeId: number;
    noticeType: string;
  }) => Promise<NoticeDetailResponse>;
  fetchNoticePage?: (input: {
    apiContext: ApiRequestContextLike;
    currentPage: number;
    noticeType: string;
    pageSize: number;
  }) => Promise<NoticeListResponse>;
  maxNotices?: number;
  noticeTypes: NoticeTypeConfig[];
  requestBackoffBaseMs: number;
  requestMaxRetries: number;
  siteId: string;
  sourceHomeUrl: string;
}

export interface CollectBootstrapBundleResult {
  bundleRecords: BundleNoticeRecord[];
  exportManifest: BootstrapExportManifest;
  stats: {
    detailFetched: number;
    noticesCollected: number;
    pagesFetched: number;
  };
}

export interface WriteBootstrapArtifactsInput {
  bundleRecords: BundleNoticeRecord[];
  exportManifest: BootstrapExportManifest;
  outputDir: string;
}

export interface WriteBootstrapArtifactsResult {
  bundlePath: string;
  manifestPath: string;
}

export function buildBundleRecord(input: {
  detailInfo: NoticeDetailInfo | null | undefined;
  notice: NoticeItem;
  observedAt: string;
  sourceHomeUrl?: string;
}): BundleNoticeRecord {
  const noticeId = normalizeRequiredNoticeId(input.notice.notice_id ?? input.detailInfo?.notice_id);
  const noticeTitle = normalizeRequiredText(input.notice.notice_title ?? input.detailInfo?.notice_title, "notice_title");
  const artifacts = buildReferenceArtifacts({
    htmlValue: normalizeNullableText(input.detailInfo?.notice_content ?? input.notice.notice_content) ?? "",
    noticeId,
    observedAt: input.observedAt,
    sourceHomeUrl: input.sourceHomeUrl,
  });
  return {
    notice_id: noticeId,
    notice: {
      categories: buildCategories({
        notice: input.notice,
        noticeId,
        observedAt: input.observedAt,
      }),
      enrich_attempted_at: input.observedAt,
      last_seen_at: input.observedAt,
      notice_content: normalizeNullableText(input.detailInfo?.notice_content ?? input.notice.notice_content),
      notice_create_time: normalizeNullableText(input.detailInfo?.notice_create_time ?? input.notice.notice_create_time),
      notice_first_time: normalizeNullableText(input.detailInfo?.notice_first_time ?? input.notice.notice_first_time),
      notice_id: noticeId,
      notice_link: normalizeNullableText(input.detailInfo?.notice_link ?? input.notice.notice_link),
      notice_link_state: normalizeNullableNumber(input.detailInfo?.notice_link_state ?? input.notice.notice_link_state),
      notice_release_time: normalizeNullableText(input.detailInfo?.notice_release_time ?? input.notice.notice_release_time),
      notice_source: normalizeNullableNumber(input.detailInfo?.notice_source ?? input.notice.notice_source),
      notice_state: normalizeNullableNumber(input.detailInfo?.notice_state ?? input.notice.notice_state),
      notice_stick: normalizeNullableNumber(input.detailInfo?.notice_stick ?? input.notice.notice_stick),
      notice_title: noticeTitle,
      organization_id: normalizeNullableText(input.detailInfo?.organization_id ?? input.notice.organization_id),
      organization_name: normalizeNullableText(input.detailInfo?.organization_name ?? input.notice.organization_name),
    },
    notice_attachments: artifacts.noticeAttachments,
    attachments: artifacts.attachments,
    links: artifacts.links,
  };
}

export async function collectBootstrapBundle(
  input: CollectBootstrapBundleInput,
): Promise<CollectBootstrapBundleResult> {
  const createApiContext =
    input.createApiContext ??
    (() => createApiContextFromStorageState(resolveCollectorConfig(process.env)));
  const apiContext = await createApiContext();
  const fetchPage =
    input.fetchNoticePage ??
    ((pageInput) =>
      fetchNoticePage({
        ...pageInput,
        requestBackoffBaseMs: input.requestBackoffBaseMs,
        requestMaxRetries: input.requestMaxRetries,
      }));
  const fetchDetail =
    input.fetchNoticeDetail ??
    ((detailInput) =>
      fetchNoticeDetail({
        ...detailInput,
        requestBackoffBaseMs: input.requestBackoffBaseMs,
        requestMaxRetries: input.requestMaxRetries,
      }));

  const bundleMap = new Map<number, BundleNoticeRecord>();
  let detailFetched = 0;
  let itemsSeen = 0;
  let pagesFetched = 0;

  try {
    for (const noticeType of input.noticeTypes) {
      for (let currentPage = 1; currentPage <= noticeType.incrementalPages; currentPage += 1) {
        if (input.maxNotices && bundleMap.size >= input.maxNotices) {
          break;
        }

        const pageResponse = await fetchPage({
          apiContext,
          currentPage,
          noticeType: noticeType.type,
          pageSize: noticeType.incrementalPageSize,
        });
        pagesFetched += 1;

        const items = pageResponse.datas?.tables ?? [];
        itemsSeen += items.length;

        for (const item of items) {
          const noticeId = normalizeOptionalNoticeId(item.notice_id);
          if (noticeId === null) {
            continue;
          }
          const existing = bundleMap.get(noticeId);
          if (existing) {
            bundleMap.set(noticeId, mergeBundleRecord(existing, item, input.exportedAt));
            continue;
          }
          if (input.maxNotices && bundleMap.size >= input.maxNotices) {
            break;
          }
          const detailResponse = await fetchDetail({
            apiContext,
            noticeId,
            noticeType: normalizeNoticeType(item.notice_type ?? noticeType.type),
          });
          detailFetched += 1;
          bundleMap.set(
            noticeId,
            buildBundleRecord({
              detailInfo: detailResponse.datas?.notice_info,
              notice: item,
              observedAt: input.exportedAt,
              sourceHomeUrl: input.sourceHomeUrl,
            }),
          );
        }

        const totalCounts = pageResponse.datas?.page?.totalCounts;
        if (typeof totalCounts === "number" && currentPage >= totalCounts) {
          break;
        }
      }

      if (input.maxNotices && bundleMap.size >= input.maxNotices) {
        break;
      }
    }
  } finally {
    await apiContext.dispose();
  }

  const bundleRecords = [...bundleMap.values()];
  return {
    bundleRecords,
    exportManifest: buildExportManifest({
      detailFetched,
      exportedAt: input.exportedAt,
      itemsInserted: bundleRecords.length,
      itemsSeen,
      maxNotices: input.maxNotices ?? null,
      noticeTypes: input.noticeTypes,
      pagesFetched,
      siteId: input.siteId,
      sourceHomeUrl: input.sourceHomeUrl,
    }),
    stats: {
      detailFetched,
      noticesCollected: bundleRecords.length,
      pagesFetched,
    },
  };
}

export function writeBootstrapArtifacts(input: WriteBootstrapArtifactsInput): WriteBootstrapArtifactsResult {
  fs.mkdirSync(input.outputDir, { recursive: true });
  const timestamp = toTimestampLabel(input.exportManifest.exported_at);
  const bundlePath = path.join(input.outputDir, `notices-bundle-${timestamp}.json`);
  const manifestPath = path.join(input.outputDir, `export-manifest-${timestamp}.json`);

  fs.writeFileSync(bundlePath, `${JSON.stringify(input.bundleRecords, null, 2)}\n`, "utf-8");
  fs.writeFileSync(manifestPath, `${JSON.stringify(input.exportManifest, null, 2)}\n`, "utf-8");

  return {
    bundlePath,
    manifestPath,
  };
}

function buildExportManifest(input: {
  detailFetched: number;
  exportedAt: string;
  itemsInserted: number;
  itemsSeen: number;
  maxNotices: number | null;
  noticeTypes: NoticeTypeConfig[];
  pagesFetched: number;
  siteId: string;
  sourceHomeUrl: string;
}): BootstrapExportManifest {
  const timestamp = toTimestampLabel(input.exportedAt);
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: input.exportedAt,
    export_date: timestamp.slice(0, 8),
    export_scope: `bootstrap-${timestamp}`,
    source_channel: AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
    site_id: input.siteId,
    source_home_url: input.sourceHomeUrl,
    collector: COLLECTOR_EXPORT_METADATA,
    filters: {
      max_notices: input.maxNotices,
      notice_types: input.noticeTypes.map((item) => item.type),
    },
    notice_type_policy: buildNoticeTypePolicySnapshot(input.noticeTypes),
    run: {
      detail_fetched: input.detailFetched,
      errors: 0,
      finished_at: input.exportedAt,
      items_inserted: input.itemsInserted,
      items_seen: input.itemsSeen,
      mode: "bootstrap_export",
      pages_fetched: input.pagesFetched,
      started_at: input.exportedAt,
      status: "success",
    },
  };
}

function mergeBundleRecord(
  existing: BundleNoticeRecord,
  notice: NoticeItem,
  observedAt: string,
): BundleNoticeRecord {
  const categories = dedupeCategories(
    existing.notice.categories,
    buildCategories({
      notice,
      noticeId: existing.notice_id,
      observedAt,
    }),
  );
  const mergedNotice: BundleNoticePayload = {
    ...existing.notice,
    categories,
    notice_content: existing.notice.notice_content ?? normalizeNullableText(notice.notice_content),
    notice_create_time: existing.notice.notice_create_time ?? normalizeNullableText(notice.notice_create_time),
    notice_first_time: existing.notice.notice_first_time ?? normalizeNullableText(notice.notice_first_time),
    notice_link: existing.notice.notice_link ?? normalizeNullableText(notice.notice_link),
    notice_release_time: existing.notice.notice_release_time ?? normalizeNullableText(notice.notice_release_time),
    organization_id: existing.notice.organization_id ?? normalizeNullableText(notice.organization_id),
    organization_name: existing.notice.organization_name ?? normalizeNullableText(notice.organization_name),
  };
  return {
    ...existing,
    notice: mergedNotice,
  };
}

function buildReferenceArtifacts(input: {
  htmlValue: string;
  noticeId: number;
  observedAt: string;
  sourceHomeUrl?: string;
}): {
  links: BundleLinkObservation[];
  noticeAttachments: BundleNoticeAttachmentRelation[];
  attachments: BundleAttachmentObservation[];
} {
  const links: BundleLinkObservation[] = [];
  const noticeAttachments: BundleNoticeAttachmentRelation[] = [];
  const attachments: BundleAttachmentObservation[] = [];
  const attachmentIds = new Map<string, number>();
  let nextLinkId = 1;
  let nextAttachmentId = 1;

  for (const match of input.htmlValue.matchAll(HTML_ANCHOR_RE)) {
    const rawHref = decodeHtmlAttribute(String(match[2] || ""));
    const linkText = normalizeNullableText(stripHtml(String(match[3] || "")));
    if (!rawHref) {
      continue;
    }
    const resolvedLink = resolveLinkTarget({
      rawHref,
      sourceHomeUrl: input.sourceHomeUrl,
    });
    const contentKind = isAttachmentLike({
      href: rawHref,
      linkText,
      finalUrl: resolvedLink.finalUrl,
    })
      ? "attachment_list"
      : "body_link";
    const linkId = nextLinkId;
    nextLinkId += 1;
    links.push({
      id: linkId,
      notice_id: input.noticeId,
      run_id: null,
      source: "content",
      content_kind: contentKind,
      url: rawHref,
      url_scheme: resolvedLink.urlScheme,
      link_host: resolvedLink.linkHost,
      link_scope: resolvedLink.linkScope,
      collect_policy: resolvedLink.collectPolicy,
      skip_reason: resolvedLink.skipReason,
      link_text: linkText,
      final_url: resolvedLink.finalUrl,
      title: null,
      status_code: null,
      content_type: null,
      downloaded: false,
      download_path: null,
      file_size: null,
      fetched_at: input.observedAt,
      error_message: resolvedLink.errorMessage,
    });

    if (
      contentKind !== "attachment_list"
      || resolvedLink.collectPolicy !== "reference_only"
      || resolvedLink.finalUrl === null
    ) {
      continue;
    }
    let attachmentId = attachmentIds.get(resolvedLink.finalUrl);
    if (attachmentId === undefined) {
      attachmentId = nextAttachmentId;
      nextAttachmentId += 1;
      attachmentIds.set(resolvedLink.finalUrl, attachmentId);
      attachments.push({
        attachment_id: attachmentId,
        source_url: resolvedLink.finalUrl,
        normalized_source_url: resolvedLink.finalUrl,
        final_url: resolvedLink.finalUrl,
        original_filename: deriveOriginalFilename(resolvedLink.finalUrl, linkText),
        mime_type: null,
        byte_size: null,
        sha256: null,
        storage_provider: "reference_only",
        bucket: null,
        object_key: null,
        etag: null,
        version_id: null,
        origin_url_scheme: resolvedLink.urlScheme,
        origin_host: resolvedLink.linkHost,
        origin_scope: resolvedLink.linkScope,
        provenance_status: "reference_only",
        ingest_status: "reference_only",
        local_path: null,
        downloaded_at: null,
        uploaded_at: null,
        last_error: null,
        created_at: input.observedAt,
        updated_at: input.observedAt,
      });
    }
    noticeAttachments.push({
      notice_id: input.noticeId,
      attachment_id: attachmentId,
      link_id: linkId,
      relation_source: "content",
      resource_role: "attachment",
      anchor_text: linkText,
      discovered_at: input.observedAt,
    });
  }

  return {
    links,
    noticeAttachments,
    attachments,
  };
}

function buildCategories(input: {
  notice: NoticeItem;
  noticeId: number;
  observedAt: string;
}): NoticeCategoryRecord[] {
  const noticeType = normalizeNoticeType(input.notice.notice_type);
  if (!noticeType) {
    return [];
  }
  return [
    {
      notice_id: input.noticeId,
      notice_type: noticeType,
      notice_type_name: normalizeNullableText(input.notice.notice_type_name),
      category_first_seen_at: input.observedAt,
      category_last_seen_at: input.observedAt,
      category_last_run_id: null,
    },
  ];
}

function dedupeCategories(
  ...categorySets: NoticeCategoryRecord[][]
): NoticeCategoryRecord[] {
  const merged = new Map<string, NoticeCategoryRecord>();
  for (const categorySet of categorySets) {
    for (const category of categorySet) {
      merged.set(category.notice_type, category);
    }
  }
  return [...merged.values()];
}

function normalizeOptionalNoticeId(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function normalizeRequiredNoticeId(value: number | string | null | undefined): number {
  const noticeId = normalizeOptionalNoticeId(value);
  if (noticeId === null) {
    throw new Error("notice_id is required");
  }
  return noticeId;
}

function normalizeNoticeType(value: number | string | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function resolveLinkTarget(input: {
  rawHref: string;
  sourceHomeUrl?: string;
}): {
  collectPolicy: "reference_only" | "skip_scheme";
  errorMessage: string | null;
  finalUrl: string | null;
  linkHost: string | null;
  linkScope: "internal" | "external" | "unsupported";
  skipReason: "unsupported_scheme" | null;
  urlScheme: string | null;
} {
  const explicitScheme = extractUrlScheme(input.rawHref);
  if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
    return {
      collectPolicy: "skip_scheme",
      errorMessage: "unsupported scheme",
      finalUrl: null,
      linkHost: null,
      linkScope: "unsupported",
      skipReason: "unsupported_scheme",
      urlScheme: explicitScheme,
    };
  }

  try {
    const url = input.sourceHomeUrl
      ? new URL(input.rawHref, input.sourceHomeUrl)
      : new URL(input.rawHref);
    const sourceHome = input.sourceHomeUrl ? new URL(input.sourceHomeUrl) : null;
    return {
      collectPolicy: "reference_only",
      errorMessage: null,
      finalUrl: url.toString(),
      linkHost: url.host || null,
      linkScope: sourceHome && sourceHome.host === url.host ? "internal" : "external",
      skipReason: null,
      urlScheme: url.protocol.replace(/:$/, "") || null,
    };
  } catch {
    return {
      collectPolicy: "skip_scheme",
      errorMessage: "unsupported scheme",
      finalUrl: null,
      linkHost: null,
      linkScope: "unsupported",
      skipReason: "unsupported_scheme",
      urlScheme: explicitScheme,
    };
  }
}

function isAttachmentLike(input: {
  href: string;
  linkText: string | null;
  finalUrl: string | null;
}): boolean {
  const candidate = input.finalUrl ?? input.href;
  try {
    const parsed = new URL(candidate);
    const extension = path.posix.extname(parsed.pathname).toLowerCase();
    if (ATTACHMENT_FILE_EXTENSIONS.has(extension)) {
      return true;
    }
  } catch {
    return false;
  }
  return /附件|下载/.test(`${input.linkText ?? ""}${candidate}`);
}

function deriveOriginalFilename(finalUrl: string, linkText: string | null): string | null {
  try {
    const parsed = new URL(finalUrl);
    const filename = safeDecodeURIComponent(path.posix.basename(parsed.pathname));
    if (filename) {
      return filename;
    }
  } catch {
    return linkText;
  }
  return linkText;
}

function extractUrlScheme(value: string): string | null {
  const match = value.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
  return match ? match[1]!.toLowerCase() : null;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value: string): string {
  return value.replace(HTML_TAG_RE, " ").replace(WHITESPACE_RE, " ").trim();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
  const text = normalizeNullableText(value);
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  return text;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function toTimestampLabel(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(".000", "");
}

export async function main(): Promise<void> {
  loadCollectorEnv();
  const config = resolveCollectorConfig(process.env);
  ensureRuntimeDirs(config);
  const noticeTypes = getEnabledNoticeTypes(loadNoticeTypes(config.noticeTypesPath));
  const exportedAt = new Date().toISOString();
  const result = await collectBootstrapBundle({
    exportedAt,
    noticeTypes,
    requestBackoffBaseMs: config.requestBackoffBaseMs,
    requestMaxRetries: config.requestMaxRetries,
    siteId: config.siteId,
    sourceHomeUrl: config.sourceHomeUrl,
  });
  const written = writeBootstrapArtifacts({
    bundleRecords: result.bundleRecords,
    exportManifest: result.exportManifest,
    outputDir: config.exportsDir,
  });
  console.log(
    JSON.stringify(
      {
        ...result.stats,
        bundlePath: written.bundlePath,
        manifestPath: written.manifestPath,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
