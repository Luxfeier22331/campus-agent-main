import { TextEncoder } from "node:util";

import type { CheerioCrawlingContext } from "crawlee";
import {
  admitOfficialWebUrl,
  buildOfficialWebContentBlockRow,
  buildOfficialWebDiscoveredLinkRecord,
  buildOfficialWebPageManifest,
  buildOfficialWebProviderPageExtraction,
  buildOfficialWebRawAssetId,
  buildOfficialWebRawVersionId,
  buildOfficialWebSourceArtifactKey,
  buildOfficialWebUrlIdentity,
  hashOfficialWebContent,
  type OfficialWebConfigBundle,
  type OfficialWebContentBlockRow,
  type OfficialWebDiscoveredLinkRecord,
  type OfficialWebHostPolicy,
  type OfficialWebPageFamily,
  type OfficialWebPageManifest,
  type OfficialWebPageSignalSummary,
  type OfficialWebProviderPageExtraction,
} from "./official-web-core.ts";

import {
  OFFICIAL_WEB_FETCHER_NAME,
  OFFICIAL_WEB_FETCHER_VERSION,
  OFFICIAL_WEB_PARSER_NAME,
  OFFICIAL_WEB_PARSER_SLUG,
  OFFICIAL_WEB_PARSER_VERSION,
} from "./runtime-metadata.ts";

const encoder = new TextEncoder();
const SHANGHAI_TIMEZONE_OFFSET = "+08:00";
const PUBLISHED_AT_ALLOWED_PAGE_FAMILIES = new Set<OfficialWebPageFamily>([
  "article_detail",
  "generic_content_page",
]);

export interface CollectorArtifactFile {
  relativePath: string;
  objectKey: string;
  contentType: string;
  data: Uint8Array;
  recordCount?: number;
}

export interface CollectedPageArtifact {
  rawAssetId: string;
  rawVersionId: string;
  pageManifest: OfficialWebPageManifest;
  contentBlocks: OfficialWebContentBlockRow[];
  discoveredLinks: OfficialWebDiscoveredLinkRecord[];
  providerExtraction: OfficialWebProviderPageExtraction;
  files: CollectorArtifactFile[];
}

interface ExtractedBlockCandidate {
  blockRole: OfficialWebContentBlockRow["blockRole"];
  headingLevel: number | null;
  domPath: string | null;
  parentHeadingPath: string[];
  listLevel: number | null;
  tableId: string | null;
  tableRowIndex: number | null;
  tableColIndex: number | null;
  textRaw: string | null;
  textNormalized: string | null;
  htmlFragment: string | null;
  linkTarget: string | null;
  linkText: string | null;
  tableHtml: string | null;
  tableCells: string[][] | null;
  isNavigation: boolean;
  isBoilerplate: boolean;
  isMainContent: boolean;
  mainContentScore: number;
  titleCandidateScore: number;
  sectionHint: string | null;
  classificationConfidence: number;
  classificationReason: string | null;
  parentHeadingHint: string | null;
}

interface PageFamilyClassification {
  pageFamily: OfficialWebPageFamily;
  confidence: number;
  reason: string;
}

interface VisibleContentContainerStats {
  element: unknown;
  textLength: number;
  mediaCount: number;
  listCount: number;
  anchorCount: number;
  dateLikeTextCount: number;
  repeatedCardChildCount: number;
  hasPagination: boolean;
}

export function buildCollectedPageArtifacts(input: {
  bundle: OfficialWebConfigBundle;
  plan: {
    crawlRunId: string;
  };
  hostPolicy: OfficialWebHostPolicy;
  requestedUrl: string;
  finalUrl: string;
  declaredCanonicalUrl: string | null;
  responseBody: string;
  responseHeaders: Record<string, string | string[] | undefined>;
  httpStatus: number;
  contentType: string;
  discoveryMethod: "seed" | "robots_sitemap" | "configured_sitemap" | "navigation" | "manual_requeue";
  discoveredFromUrl: string | null;
  fetchedAt: string;
  html: CheerioCrawlingContext["$"];
}): CollectedPageArtifact {
  const urlIdentity = buildOfficialWebUrlIdentity(input.bundle, {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    declaredCanonicalUrl: input.declaredCanonicalUrl,
  });
  prepareHtmlForExtraction({
    html: input.html,
    finalUrl: input.finalUrl,
  });
  const responseBodyHash = hashOfficialWebContent(input.responseBody);
  const initialExtractedBlocks = extractBlockCandidates({
    html: input.html,
    baseUrl: input.finalUrl,
    siteDisplayName: input.bundle.site.displayName,
  });
  const recoveredBlocks =
    initialExtractedBlocks.some((item) => item.isMainContent)
      ? []
      : extractRecoveryBlockCandidates({
          html: input.html,
          baseUrl: input.finalUrl,
          siteDisplayName: input.bundle.site.displayName,
        });
  const extractedBlocks = mergeExtractedBlockCandidates(initialExtractedBlocks, recoveredBlocks);
  const normalizedMainContent = extractedBlocks
    .filter((item) => item.isMainContent && item.textNormalized != null && item.textNormalized.length > 0)
    .map((item) => item.textNormalized);
  const mainContentHash = hashOfficialWebContent(normalizedMainContent.join("\n"));
  const rawAssetId = buildOfficialWebRawAssetId({
    siteId: input.bundle.site.siteId,
    normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
  });
  const rawVersionId = buildOfficialWebRawVersionId({
    normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
    responseBodyHash,
    mainContentHash,
  });
  const repeatedTextCounts = countRepeatedCandidateTexts(extractedBlocks);
  const contentBlocks = extractedBlocks.map((item, index) =>
    buildOfficialWebContentBlockRow({
      rawAssetId,
      rawVersionId,
      rowIndex: index,
      blockOrder: index,
      blockRole: item.blockRole,
      headingLevel: item.headingLevel,
      domPath: item.domPath,
      parentHeadingPath: item.parentHeadingPath,
      listLevel: item.listLevel,
      tableId: item.tableId,
      tableRowIndex: item.tableRowIndex,
      tableColIndex: item.tableColIndex,
      textRaw: item.textRaw,
      textNormalized: item.textNormalized,
      htmlFragment: item.htmlFragment,
      linkTarget: item.linkTarget,
      linkText: item.linkText,
      tableHtml: item.tableHtml,
      tableCells: item.tableCells,
      isNavigation: item.isNavigation,
      isBoilerplate: item.isBoilerplate,
      isMainContent: item.isMainContent,
      isRepeatedCandidate: isRepeatedCandidate(item, repeatedTextCounts),
      mainContentScore: item.mainContentScore,
      titleCandidateScore: item.titleCandidateScore,
      sectionHint: item.sectionHint,
      classificationConfidence: item.classificationConfidence,
      classificationReason: item.classificationReason,
      parentHeadingHint: item.parentHeadingHint,
    }),
  );
  const discoveredLinks = extractDiscoveredLinks({
    html: input.html,
    baseUrl: input.finalUrl,
    bundle: input.bundle,
    hostPolicy: input.hostPolicy,
    rawAssetId,
    rawVersionId,
  });
  const languageHint = normalizeOptionalString((input.html("html").attr("lang") ?? "").trim());
  const pageTitleRaw =
    normalizeOptionalString((input.html("title").first().text() ?? "").trim()) ??
    contentBlocks.find((item) => item.blockRole === "heading" && item.headingLevel === 1)?.textNormalized ??
    null;
  const pageTitleNormalized = normalizePageTitle(pageTitleRaw, input.bundle.site.displayName);
  const pageSignals = summarizePageSignals({
    contentBlocks,
    html: input.html,
    responseBody: input.responseBody,
  });
  const pageFamily = classifyPageFamily({
    hostPolicy: input.hostPolicy,
    finalUrl: input.finalUrl,
    pageTitleNormalized,
    pageSignals,
  });
  const navigationBlockCount = contentBlocks.filter((item) => item.isNavigation).length;
  const boilerplateBlockCount = contentBlocks.filter((item) => item.isBoilerplate).length;
  const mainContentBlockCount = contentBlocks.filter((item) => item.isMainContent).length;
  const retainedSnapshotHash = responseBodyHash;
  const serializedHeaders = serializeResponseHeaders(input.responseHeaders);
  const redirectChain = input.requestedUrl === input.finalUrl ? [input.finalUrl] : [input.requestedUrl, input.finalUrl];
  const publishedAt = extractCanonicalPublishedAt({
    html: input.html,
    pageFamily: pageFamily.pageFamily,
  });

  const pageManifest = buildOfficialWebPageManifest({
    siteId: input.bundle.site.siteId,
    host: input.hostPolicy.host,
    rawAssetId,
    rawVersionId,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    declaredCanonicalUrl: input.declaredCanonicalUrl,
    normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
    urlIdentityBasis: urlIdentity.urlIdentityBasis,
    fetchedAt: input.fetchedAt,
    publishedAt,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    etag: readHeaderValue(serializedHeaders, "etag"),
    lastModified: readHeaderValue(serializedHeaders, "last-modified"),
    redirectChain,
    responseBodyHash,
    retainedSnapshotHash,
    fetcherName: OFFICIAL_WEB_FETCHER_NAME,
    fetcherVersion: OFFICIAL_WEB_FETCHER_VERSION,
    parserName: OFFICIAL_WEB_PARSER_NAME,
    parserVersion: OFFICIAL_WEB_PARSER_VERSION,
    pageTitleRaw,
    pageTitleNormalized,
    languageHint,
    pageFamily: pageFamily.pageFamily,
    pageFamilyConfidence: pageFamily.confidence,
    pageFamilyReason: pageFamily.reason,
    mainContentHash,
    blockCount: contentBlocks.length,
    mainContentBlockCount,
    navigationBlockCount,
    boilerplateBlockCount,
    discoveredFromUrl: input.discoveredFromUrl,
    discoveryMethod: input.discoveryMethod,
    crawlRunId: input.plan.crawlRunId,
    hostPolicyVersion: input.bundle.site.hostPolicyVersion,
    crawlPolicyVersion: input.bundle.site.crawlPolicyVersion,
    credentialsMode: input.bundle.site.credentialsMode,
  });

  const providerExtraction = buildOfficialWebProviderPageExtraction({
    rawAssetId,
    rawVersionId,
    parserSlug: OFFICIAL_WEB_PARSER_SLUG,
    parserName: OFFICIAL_WEB_PARSER_NAME,
    parserVersion: OFFICIAL_WEB_PARSER_VERSION,
    pageTitleRaw,
    pageTitleNormalized,
    languageHint,
    pageFamily: pageFamily.pageFamily,
    pageFamilyConfidence: pageFamily.confidence,
    pageFamilyReason: pageFamily.reason,
    mainContentHash,
    extractionSummary: {
      blockCount: contentBlocks.length,
      mainContentBlockCount,
      navigationBlockCount,
      boilerplateBlockCount,
      discoveredLinkCount: discoveredLinks.length,
    },
    pageSignals,
    blockCandidates: contentBlocks.map((item) => ({
      rowId: item.rowId,
      blockRole: item.blockRole,
      textNormalized: item.textNormalized,
      domPath: item.domPath,
      isNavigation: item.isNavigation,
      isBoilerplate: item.isBoilerplate,
      isMainContent: item.isMainContent,
      mainContentScore: item.mainContentScore,
    })),
  });

  const files: CollectorArtifactFile[] = [
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: "capture/response.html",
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "capture",
        filename: "response.html",
      }),
      contentType: "text/html; charset=utf-8",
      body: input.responseBody,
    }),
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: "capture/response-headers.json",
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "capture",
        filename: "response-headers.json",
      }),
      contentType: "application/json",
      body: JSON.stringify(serializedHeaders, null, 2),
    }),
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: "capture/fetch-metadata.json",
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "capture",
        filename: "fetch-metadata.json",
      }),
      contentType: "application/json",
      body: JSON.stringify(
        {
          schemaVersion: "official_web_fetch_metadata.v1",
          requestedUrl: input.requestedUrl,
          finalUrl: input.finalUrl,
          declaredCanonicalUrl: input.declaredCanonicalUrl,
          normalizedCanonicalUrl: urlIdentity.normalizedCanonicalUrl,
          urlIdentityBasis: urlIdentity.urlIdentityBasis,
          fetchedAt: input.fetchedAt,
          httpStatus: input.httpStatus,
          contentType: input.contentType,
          redirectChain,
          headers: serializedHeaders,
        },
        null,
        2,
      ),
    }),
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: `provider/${OFFICIAL_WEB_PARSER_SLUG}/page-extraction.json`,
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "provider",
        parserSlug: OFFICIAL_WEB_PARSER_SLUG,
        filename: "page-extraction.json",
      }),
      contentType: "application/json",
      body: JSON.stringify(providerExtraction, null, 2),
    }),
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: `provider/${OFFICIAL_WEB_PARSER_SLUG}/discovered-links.jsonl`,
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "provider",
        parserSlug: OFFICIAL_WEB_PARSER_SLUG,
        filename: "discovered-links.jsonl",
      }),
      contentType: "application/x-ndjson",
      body: toJsonLines(discoveredLinks),
      recordCount: discoveredLinks.length,
    }),
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: "source-truth/page-manifest.json",
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "source-truth",
        filename: "page-manifest.json",
      }),
      contentType: "application/json",
      body: JSON.stringify(pageManifest, null, 2),
    }),
    buildFileArtifact({
      rawAssetId,
      rawVersionId,
      relativePath: "source-truth/content-blocks.jsonl",
      objectKey: buildOfficialWebSourceArtifactKey({
        rawAssetId,
        rawVersionId,
        stage: "source-truth",
        filename: "content-blocks.jsonl",
      }),
      contentType: "application/x-ndjson",
      body: toJsonLines(contentBlocks),
      recordCount: contentBlocks.length,
    }),
  ];

  return {
    rawAssetId,
    rawVersionId,
    pageManifest,
    contentBlocks,
    discoveredLinks,
    providerExtraction,
    files,
  };
}

function prepareHtmlForExtraction(input: {
  html: CheerioCrawlingContext["$"];
  finalUrl: string;
}): void {
  hydrateEngine2DetailRichText(input.html, input.finalUrl);
}

function hydrateEngine2DetailRichText(
  html: CheerioCrawlingContext["$"],
  finalUrl: string,
): void {
  if (!isEngine2DetailLikeUrl(finalUrl)) {
    return;
  }

  const $ = html as any;
  const editor = $("#editor1");
  if (editor.length === 0) {
    return;
  }

  const existingText = normalizeText(editor.text());
  if (existingText != null && existingText.length >= 24) {
    return;
  }

  const recoveredHtml = extractEngine2BootstrapRichText($);
  if (recoveredHtml == null) {
    return;
  }

  editor.html(recoveredHtml);
}

function extractEngine2BootstrapRichText($: any): string | null {
  const candidatePayloads: string[] = [];

  for (const script of $("script").toArray() as unknown[]) {
    const scriptText = normalizeOptionalString($(script).html() ?? $(script).text());
    if (scriptText == null || !/renderRichtext\(["']editor1["']\s*,/i.test(scriptText)) {
      continue;
    }

    for (const match of scriptText.matchAll(/(?:["']content["']|content)\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
      const decoded = decodeJsonEscapedHtml(match[1] ?? "");
      if (decoded == null) {
        continue;
      }
      candidatePayloads.push(decoded);
    }
  }

  const recovered = candidatePayloads
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && /<(?:p|div|section|article|img|a|ul|ol|table)\b/i.test(value))
    .sort((left, right) => right.length - left.length)[0];

  return recovered ?? null;
}

function decodeJsonEscapedHtml(value: string): string | null {
  try {
    const decoded = JSON.parse(`"${value}"`);
    return typeof decoded === "string" ? decoded : null;
  } catch {
    return null;
  }
}

function isEngine2DetailLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^\/engine2\/d\/[^/]+\/[^/]+\/[^/]+$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function buildFileArtifact(input: {
  rawAssetId: string;
  rawVersionId: string;
  relativePath: string;
  objectKey: string;
  contentType: string;
  body: string;
  recordCount?: number;
}): CollectorArtifactFile {
  return {
    relativePath: input.relativePath,
    objectKey: input.objectKey,
    contentType: input.contentType,
    data: encoder.encode(input.body),
    recordCount: input.recordCount,
  };
}

function mergeExtractedBlockCandidates(
  initial: ExtractedBlockCandidate[],
  recovered: ExtractedBlockCandidate[],
): ExtractedBlockCandidate[] {
  if (recovered.length === 0) {
    return initial;
  }

  const merged = [...initial];
  const keyToIndex = new Map(
    initial.map((item, index) => [buildExtractedBlockCandidateKey(item), index]),
  );

  for (const item of recovered) {
    const key = buildExtractedBlockCandidateKey(item);
    const existingIndex = keyToIndex.get(key);
    if (existingIndex != null) {
      const existing = merged[existingIndex];
      if (existing != null && item.isMainContent && !existing.isMainContent) {
        merged[existingIndex] = item;
      }
      continue;
    }
    keyToIndex.set(key, merged.length);
    merged.push(item);
  }

  return merged;
}

function buildExtractedBlockCandidateKey(
  candidate: Pick<ExtractedBlockCandidate, "blockRole" | "domPath" | "textNormalized" | "linkTarget">,
): string {
  return [
    candidate.blockRole,
    candidate.domPath ?? "",
    candidate.textNormalized ?? "",
    candidate.linkTarget ?? "",
  ].join("::");
}

function extractRecoveryBlockCandidates(input: {
  html: CheerioCrawlingContext["$"];
  baseUrl: string;
  siteDisplayName: string;
}): ExtractedBlockCandidate[] {
  const $ = input.html as any;
  const containers = selectRecoverableContentContainers($, analyzeVisibleContentContainers(input.html));
  if (containers.length === 0) {
    return [];
  }

  const candidates: ExtractedBlockCandidate[] = [];
  const seenDomPaths = new Set<string>();

  for (const container of containers) {
    const selector = isListingLikeRecoveryContainer(container)
      ? "a,div,span,time"
      : "h1,h2,h3,h4,h5,h6,p,li,dt,dd,div,section,article,span,time,a";
    const elements = $(container.element).find(selector).toArray() as unknown[];

    for (const element of elements) {
      const tagName = String((element as { tagName?: unknown }).tagName ?? "").toLowerCase();
      if (tagName.length === 0) {
        continue;
      }
      if (shouldSuppressVisuallyHiddenElement($, element)) {
        continue;
      }

      const domPath = buildDomPath($, element);
      if (domPath == null || seenDomPaths.has(domPath)) {
        continue;
      }

      const textRaw = extractElementText($, element);
      if (textRaw == null) {
        continue;
      }

      if (!shouldRecoverElement($, element, tagName, container, input.baseUrl)) {
        continue;
      }

      const textNormalized = tagName === "title" ? normalizePageTitle(textRaw, input.siteDisplayName) : normalizeText(textRaw);
      if (textNormalized == null) {
        continue;
      }

      seenDomPaths.add(domPath);
      candidates.push({
        blockRole: resolveRecoveryBlockRole(tagName),
        headingLevel: /^h\d$/.test(tagName) ? Number.parseInt(tagName.slice(1), 10) : null,
        domPath,
        parentHeadingPath: [],
        listLevel:
          tagName === "li"
            ? $(element).parents("ul,ol").length
            : tagName === "dt" || tagName === "dd"
              ? $(element).parents("dl").length
              : null,
        tableId: null,
        tableRowIndex: null,
        tableColIndex: null,
        textRaw,
        textNormalized,
        htmlFragment: extractElementHtmlFragment($, element),
        linkTarget: tagName === "a" ? resolveAnchorTargetUrl($, element, input.baseUrl) : null,
        linkText: tagName === "a" ? textNormalized : null,
        tableHtml: null,
        tableCells: null,
        isNavigation: false,
        isBoilerplate: false,
        isMainContent: true,
        mainContentScore: 0.88,
        titleCandidateScore: /^h1$/.test(tagName) ? 1 : 0,
        sectionHint: null,
        classificationConfidence: 0.82,
        classificationReason: "visible_content_recovery",
        parentHeadingHint: null,
      });
    }
  }

  return candidates;
}

function extractBlockCandidates(input: {
  html: CheerioCrawlingContext["$"];
  baseUrl: string;
  siteDisplayName: string;
}): ExtractedBlockCandidate[] {
  const $ = input.html as any;
  const selector = [
    "title",
    "body h1",
    "body h2",
    "body h3",
    "body h4",
    "body h5",
    "body h6",
    "body p",
    "body li",
    "body dt",
    "body table",
    "body a",
  ].join(", ");
  const elements = $(selector).toArray() as unknown[];
  const headingPath: string[] = [];
  const candidates: ExtractedBlockCandidate[] = [];

  for (const element of elements) {
    const tagName = String((element as { tagName?: unknown }).tagName ?? "").toLowerCase();
    if (tagName === "li" && shouldSuppressAggregateListItem($, element)) {
      continue;
    }
    if (tagName === "table" && shouldSuppressAggregateTable($, element)) {
      continue;
    }
    if (tagName !== "title" && shouldSuppressVisuallyHiddenElement($, element)) {
      continue;
    }

    const textRaw = extractElementText($, element);
    if (textRaw == null && tagName !== "table") {
      continue;
    }

    const domPath = buildDomPath($, element);
    const hasMainContentAncestor = hasMainContentAncestorCue($, element);
    const isInBoilerplateRegion = hasBoilerplateRegionAncestor($, element);
    const hasNavigationalListAncestor =
      tagName === "a" ? hasNavigationalListContext($, element, hasMainContentAncestor) : false;
    const isNavigation =
      hasNavigationAncestor($, element) ||
      hasNavigationalListAncestor ||
      ((tagName === "li" || tagName === "dt") &&
        isLikelyNavigationalListItem($, element, hasMainContentAncestor));
    const isFooter = hasTagAncestor($, element, "footer");
    const isBoilerplate = isNavigation || isFooter || isInBoilerplateRegion;
    const headingLevel = /^h\d$/.test(tagName) ? Number.parseInt(tagName.slice(1), 10) : null;
    const isStructuralHeading =
      headingLevel != null && shouldUpdateHeadingPath($, element, isBoilerplate);
    const parentHeadingPath =
      isBoilerplate
        ? []
        : headingLevel != null
          ? compactHeadingPath(
              isStructuralHeading
                ? headingPath.slice(0, Math.max(headingLevel - 1, 0))
                : headingPath,
            )
          : compactHeadingPath(headingPath);
    const textNormalized = tagName === "title" ? normalizePageTitle(textRaw, input.siteDisplayName) : normalizeText(textRaw);
    const suppressAggregateAnchorDuplicateTitle =
      !isBoilerplate &&
      shouldDemoteAggregateAnchorTitleDescendant($, element, tagName, textNormalized);
    const isMainContent = !isBoilerplate && !suppressAggregateAnchorDuplicateTitle && (
      /^h\d$/.test(tagName) ||
      tagName === "p" ||
      (tagName === "table" && isLikelyMainContentTable($, element, hasMainContentAncestor)) ||
      ((tagName === "li" || tagName === "dt") &&
        isLikelyMainContentListItem($, element, hasMainContentAncestor)) ||
      (tagName === "a" && isLikelyMainContentAnchor($, element, hasMainContentAncestor, input.baseUrl))
    );
    const sectionHint =
      isBoilerplate
        ? null
        : headingLevel != null
          ? textNormalized
          : parentHeadingPath.at(-1) ?? null;
    const parentHeadingHint = parentHeadingPath.at(-1) ?? null;

    if (isStructuralHeading && textNormalized != null && headingLevel != null) {
      headingPath.splice(headingLevel - 1);
      headingPath[headingLevel - 1] = textNormalized;
    }

    candidates.push({
      blockRole: resolveBlockRole(tagName, isNavigation, isFooter),
      headingLevel,
      domPath,
      parentHeadingPath,
      listLevel:
        tagName === "li"
          ? $(element).parents("ul,ol").length
          : tagName === "dt"
            ? $(element).parents("dl").length
            : null,
      tableId: tagName === "table" ? domPath : null,
      tableRowIndex: null,
      tableColIndex: null,
      textRaw,
      textNormalized,
      htmlFragment: tagName === "title" ? null : extractElementHtmlFragment($, element),
      linkTarget: tagName === "a" ? resolveAnchorTargetUrl($, element, input.baseUrl) : null,
      linkText: tagName === "a" ? textNormalized : null,
      tableHtml: tagName === "table" ? normalizeOptionalString($.html(element)) : null,
      tableCells: tagName === "table" ? extractTableCells($, element) : null,
      isNavigation,
      isBoilerplate,
      isMainContent,
      mainContentScore: isMainContent ? 1 : isBoilerplate ? 0.1 : 0.4,
      titleCandidateScore: tagName === "title" || headingLevel === 1 ? 1 : 0,
      sectionHint,
      classificationConfidence: isMainContent ? 0.95 : isBoilerplate ? 0.92 : 0.7,
      classificationReason: isMainContent
        ? "main_content_structure"
        : isBoilerplate
          ? isInBoilerplateRegion
            ? "boilerplate_region_ancestor"
            : "navigation_or_footer_ancestor"
          : "fallback_block_selector",
      parentHeadingHint,
    });
  }

  return candidates;
}

function extractDiscoveredLinks(input: {
  html: CheerioCrawlingContext["$"];
  baseUrl: string;
  bundle: OfficialWebConfigBundle;
  hostPolicy: OfficialWebHostPolicy;
  rawAssetId: string;
  rawVersionId: string;
}): OfficialWebDiscoveredLinkRecord[] {
  const $ = input.html as any;
  const anchors = $("a[href]").toArray() as unknown[];

  return anchors.map((element, index) => {
    const hrefRaw = String($(element).attr("href") ?? "");
    const resolvedUrl = resolveAnchorTargetUrl($, element, input.baseUrl);
    const admission =
      resolvedUrl == null
        ? null
        : admitOfficialWebUrl(input.bundle, {
            url: resolvedUrl,
            discoveryMethod: "navigation",
            sourceHost: input.hostPolicy.host,
          });

    return buildOfficialWebDiscoveredLinkRecord({
      rawAssetId: input.rawAssetId,
      rawVersionId: input.rawVersionId,
      linkOrder: index,
      sourceUrl: input.baseUrl,
      hrefRaw,
      resolvedUrl,
      normalizedUrl: admission?.admitted ? admission.normalizedUrl : null,
      linkText: normalizeText($(element).text()),
      rel: normalizeOptionalString($(element).attr("rel")),
      admitted: admission?.admitted ?? false,
      admissionReason: admission?.reason ?? "invalid_url",
    });
  });
}

function resolveBlockRole(
  tagName: string,
  isNavigation: boolean,
  isFooter: boolean,
): OfficialWebContentBlockRow["blockRole"] {
  if (tagName === "title") {
    return "title";
  }
  if (/^h\d$/.test(tagName)) {
    return "heading";
  }
  if (tagName === "p") {
    return isFooter ? "footer" : "paragraph";
  }
  if (tagName === "li") {
    return "list_item";
  }
  if (tagName === "dt") {
    return "list_item";
  }
  if (tagName === "table") {
    return "table";
  }
  if (tagName === "a") {
    return isNavigation ? "link" : "link";
  }
  return "metadata";
}

function extractElementText($: any, element: unknown): string | null {
  const tagName = String((element as { tagName?: unknown }).tagName ?? "").toLowerCase();
  if (tagName === "a") {
    const preferredStructuredText = resolvePreferredStructuredAnchorText($, element);
    if (preferredStructuredText != null) {
      return preferredStructuredText;
    }
  }

  const clone = $(element).clone();
  clone.find("script,style,noscript,template").remove();
  hydratePreferredAnchorTitleText($, clone);
  return normalizeOptionalString(stripKnownTrackingResidue(clone.text()));
}

function extractElementHtmlFragment($: any, element: unknown): string | null {
  const clone = $(element).clone();
  clone.find("script,style,noscript,template").remove();
  return normalizeOptionalString($.html(clone));
}

function shouldSuppressVisuallyHiddenElement($: any, element: unknown): boolean {
  const candidates = [element, ...($(element).parents().toArray() as unknown[])];
  return candidates.some(
    (candidate) => isDirectlyVisuallyHiddenElement($, candidate) || isSuppressedMediaOverlayElement($, candidate),
  );
}

function isDirectlyVisuallyHiddenElement($: any, element: unknown): boolean {
  const candidate = $(element);
  if (candidate.attr("hidden") != null) {
    return true;
  }

  if (String(candidate.attr("aria-hidden") ?? "").toLowerCase() === "true") {
    return true;
  }

  const normalizedStyle = String(candidate.attr("style") ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");

  if (normalizedStyle.includes("display:none") || normalizedStyle.includes("visibility:hidden")) {
    return true;
  }

  const hidesOverflowText =
    normalizedStyle.includes("overflow:hidden") &&
    (normalizedStyle.includes("height:0") ||
      normalizedStyle.includes("height:0px") ||
      /font-size:(0|1px)(;|$)/.test(normalizedStyle));

  return hidesOverflowText;
}

function isSuppressedMediaOverlayElement($: any, element: unknown): boolean {
  return $(element).is(
    "#audioDiv, #videoDiv, .grid-music-container, .grid-video-container, .m-music-lyric-wrap, .js-music-lyric-content",
  );
}

function shouldSuppressAggregateListItem($: any, element: unknown): boolean {
  const candidate = $(element);
  const anchorCount = candidate.find("a").length;
  if (anchorCount === 0) {
    return false;
  }

  const structuredDescendantCount = candidate.find("h1,h2,h3,h4,h5,h6,p,time,table").length;
  if (structuredDescendantCount === 0) {
    return false;
  }

  return (
    structuredDescendantCount >= 2 ||
    candidate.find("h1,h2,h3,h4,h5,h6,time").length > 0 ||
    hasCardLikeStructure($, element)
  );
}

function shouldSuppressAggregateTable($: any, element: unknown): boolean {
  const textNormalized = normalizeText(extractElementText($, element));
  if (textNormalized == null) {
    return true;
  }

  const ancestorTables = $(element).parents("table").toArray() as unknown[];
  return ancestorTables.some((candidate) => normalizeText(extractElementText($, candidate)) === textNormalized);
}

function isLikelyNavigationalListItem(
  $: any,
  element: unknown,
  hasMainContentAncestor: boolean,
): boolean {
  if (hasMainContentAncestor) {
    return false;
  }

  if (hasDirectoryRosterContext($, element)) {
    return false;
  }

  const candidate = $(element);
  const textNormalized = normalizeText(extractElementText($, element));
  if (textNormalized == null) {
    return false;
  }

  const anchorCount = candidate.find("a").length;
  if (anchorCount === 0) {
    return false;
  }

  const structuredDescendantCount = candidate.find("h1,h2,h3,h4,h5,h6,p,time,table").length;
  if (structuredDescendantCount > 0) {
    return false;
  }
  if (hasDateLikeDescendant($, element)) {
    return false;
  }

  const siblingCount = candidate.parent().children("li").length;
  const linkText = normalizeText(
    candidate
      .find("a")
      .toArray()
      .map((anchor: unknown) => extractElementText($, anchor) ?? "")
      .join(" "),
  );
  const linkDensity = computeTextDensity(linkText, textNormalized);
  return siblingCount >= 2 && linkDensity >= 0.75;
}

function isLikelyMainContentListItem(
  $: any,
  element: unknown,
  hasMainContentAncestor: boolean,
): boolean {
  if (hasMainContentAncestor) {
    return true;
  }

  if (hasDirectoryRosterContext($, element)) {
    return true;
  }

  const candidate = $(element);
  const anchorCount = candidate.find("a").length;
  if (anchorCount === 0) {
    return true;
  }

  const structuredDescendantCount = candidate.find("h1,h2,h3,h4,h5,h6,p,time,table").length;
  if (structuredDescendantCount > 0) {
    return true;
  }
  if (hasDateLikeDescendant($, element)) {
    return true;
  }

  const textNormalized = normalizeText(extractElementText($, element));
  if (textNormalized == null) {
    return false;
  }

  const linkText = normalizeText(
    candidate
      .find("a")
      .toArray()
      .map((anchor: unknown) => extractElementText($, anchor) ?? "")
      .join(" "),
  );
  return computeTextDensity(linkText, textNormalized) < 0.75;
}

function isLikelyMainContentAnchor(
  $: any,
  element: unknown,
  hasMainContentAncestor: boolean,
  baseUrl: string,
): boolean {
  const href = normalizeOptionalString(String($(element).attr("href") ?? "").trim());
  const onclick = normalizeOptionalString(String($(element).attr("onclick") ?? ""));
  const onclickTarget = onclick == null ? null : extractOnclickNavigationTarget(onclick);

  if (href != null && /^javascript:/i.test(href) && onclickTarget == null) {
    return false;
  }

  if (hasMainContentAncestor) {
    return true;
  }

  const closestTable = $(element).closest("table");
  if (closestTable.length > 0) {
    const tableElement = closestTable[0];
    const tableHasMainContentAncestor = hasMainContentAncestorCue($, tableElement);
    return (
      isLikelyGalleryTable($, tableElement) ||
      isLikelyListingTable($, tableElement) ||
      isLikelyMainContentTable($, tableElement, tableHasMainContentAncestor)
    );
  }

  const parentTagName = String($(element).parent()?.[0]?.tagName ?? "").toLowerCase();
  if (/^h\d$/.test(parentTagName) || parentTagName === "p") {
    return true;
  }

  const closestListItem = $(element).closest("li,dt");
  if (closestListItem.length > 0) {
    if (shouldSuppressDatedListChildAnchor($, closestListItem[0])) {
      return false;
    }
    return !isLikelyNavigationalListItem(
      $,
      closestListItem[0],
      hasMainContentAncestorCue($, closestListItem[0]),
    );
  }

  return false;
}

function hydratePreferredAnchorTitleText($: any, root: any): void {
  const anchors = [
    ...(root.is("a[title]") ? [root[0]] : []),
    ...(root.find("a[title]").toArray() as unknown[]),
  ];

  for (const anchorElement of anchors) {
    const anchor = $(anchorElement);
    const preferredTitleText = resolvePreferredAnchorTitleText($, anchor);
    if (preferredTitleText == null) {
      continue;
    }

    anchor.contents().each((_index: number, child: unknown) => {
      if (String((child as { type?: unknown }).type ?? "") === "text") {
        $(child).remove();
      }
    });
    anchor.prepend(`${preferredTitleText} `);
  }
}

function resolvePreferredAnchorTitleText($: any, anchor: any): string | null {
  const titleText = normalizeText(String(anchor.attr("title") ?? ""));
  if (titleText == null) {
    return null;
  }

  const directVisibleText = normalizeText(
    (anchor.contents().toArray() as unknown[])
      .filter((child) => String((child as { type?: unknown }).type ?? "") === "text")
      .map((child) => String((child as { data?: unknown }).data ?? ""))
      .join(" "),
  );
  if (directVisibleText == null) {
    return titleText;
  }

  if (directVisibleText === titleText) {
    return null;
  }

  if (/[.…]{1,3}$/.test(directVisibleText)) {
    return titleText;
  }

  if (titleText.startsWith(directVisibleText) && titleText.length > directVisibleText.length) {
    return titleText;
  }

  return null;
}

function resolvePreferredStructuredAnchorText($: any, element: unknown): string | null {
  const anchor = $(element);
  const structuredDescendants = anchor.find("h1,h2,h3,h4,h5,h6,p,span,time,strong,em").toArray() as unknown[];
  if (structuredDescendants.length < 2 && !hasDateLikeDescendant($, element)) {
    return null;
  }

  const scoredCandidates = structuredDescendants
    .map((candidate, index) => {
      if ($(candidate).find("h1,h2,h3,h4,h5,h6,p,span,time,strong,em").length > 0) {
        return null;
      }

      const text = normalizeText(extractElementText($, candidate));
      if (text == null || looksLikeDateText(text) || isGenericDetailLinkText(text)) {
        return null;
      }

      const tagName = String((candidate as { tagName?: unknown }).tagName ?? "").toLowerCase();
      const classOrId = `${$(candidate).attr("class") ?? ""} ${$(candidate).attr("id") ?? ""}`.toLowerCase();
      let score = 0;
      if (/^h\d$/.test(tagName)) {
        score += 6;
      }
      if (/(^|[\s_-])(title|tit|bt|name|subject|headline)([\s_-]|$)/.test(classOrId)) {
        score += 4;
      }
      if (/(^|[\s_-])(summary|excerpt|abstract|meta|date|time)([\s_-]|$)/.test(classOrId)) {
        score -= 3;
      }
      if (text.length >= 4 && text.length <= 64) {
        score += 2;
      } else if (text.length > 120) {
        score -= 2;
      }
      return { text, index, score };
    })
    .filter((item): item is { text: string; index: number; score: number } => item != null)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const best = scoredCandidates[0];
  return best != null && best.score > 0 ? best.text : null;
}

function shouldDemoteAggregateAnchorTitleDescendant(
  $: any,
  element: unknown,
  tagName: string,
  textNormalized: string | null,
): boolean {
  if (textNormalized == null || (!/^h\d$/.test(tagName) && tagName !== "p")) {
    return false;
  }

  const closestAnchor = $(element).closest("a");
  if (closestAnchor.length === 0 || closestAnchor[0] === element) {
    return false;
  }

  const preferredAnchorText = resolvePreferredStructuredAnchorText($, closestAnchor[0]);
  if (preferredAnchorText == null || preferredAnchorText !== textNormalized) {
    return false;
  }

  return hasDateLikeDescendant($, closestAnchor[0]) || closestAnchor.find("h1,h2,h3,h4,h5,h6,p").length >= 2;
}

function shouldSuppressDatedListChildAnchor($: any, listItem: unknown): boolean {
  const candidate = $(listItem);
  return candidate.find("a").length === 1 && hasDateLikeDescendant($, listItem);
}

function hasNavigationalListContext(
  $: any,
  element: unknown,
  hasMainContentAncestor: boolean,
): boolean {
  const closestListItem = $(element).closest("li,dt");
  if (closestListItem.length === 0) {
    return false;
  }

  return isLikelyNavigationalListItem(
    $,
    closestListItem[0],
    hasMainContentAncestor || hasMainContentAncestorCue($, closestListItem[0]),
  );
}

function buildDomPath($: any, element: unknown): string | null {
  const segments: string[] = [];
  let current = $(element);
  while (current.length > 0) {
    const tagName = String(current[0]?.tagName ?? "").toLowerCase();
    if (!tagName || tagName === "html") {
      break;
    }
    const parent = current.parent();
    const sameTagSiblings = parent.children(tagName);
    const index = sameTagSiblings.toArray().findIndex((candidate: unknown) => candidate === current[0]) + 1;
    segments.unshift(`${tagName}[${index}]`);
    current = parent;
  }
  return segments.length > 0 ? segments.join(" > ") : null;
}

function hasTagAncestor($: any, element: unknown, tagName: string): boolean {
  return $(element).parents(tagName).length > 0;
}

function hasMainContentAncestorCue($: any, element: unknown): boolean {
  if (hasTagAncestor($, element, "main") || hasTagAncestor($, element, "article")) {
    return true;
  }

  const candidates = [element, ...($(element).parents().toArray() as unknown[])];
  return candidates.some((candidate) => {
    if (
      hasNavigationAncestor($, candidate) ||
      hasBoilerplateRegionAncestor($, candidate) ||
      hasTagAncestor($, candidate, "header") ||
      hasTagAncestor($, candidate, "footer") ||
      hasTagAncestor($, candidate, "aside")
    ) {
      return false;
    }

    const classOrId = `${$(candidate).attr("class") ?? ""} ${$(candidate).attr("id") ?? ""}`.toLowerCase();
    return /(^|[\s_-])(vsb[_-]?content|main[_-]?content|content[_-]?main|article[_-]?content|post[_-]?content|detail[_-]?content|text[_-]?list|list[_-]?content|list[_-]?right|right[_-]?con|ny[_-]?right|wape[_-]?right|callboard|callboard[_-]?body|publishment|cic[_-]?main|content[_-]?body|content[_-]?detail|contentbox|content[_-]?box|con[_-]?box|cont[_-]?box|nr[_-]?box|xl[_-]?content)([\s_-]|$)/.test(
      classOrId,
    );
  });
}

function hasNavigationAncestor($: any, element: unknown): boolean {
  if ($(element).parents("nav,header,footer").length > 0) {
    return true;
  }

  const classOrId = [
    $(element).attr("class"),
    $(element).attr("id"),
    $(element).parents().map((_index: number, parent: unknown) => `${$(parent).attr("class") ?? ""} ${$(parent).attr("id") ?? ""}`).get().join(" "),
  ]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();

  const hasPositionContentCue = /position[_-]{1,2}content/.test(classOrId);
  const hasNavigationKeyword = /(^|[\s_-])(nav|menu|breadcrumb|footer|header|crumb|bar|dhbar|posi)([\s_-]|$)/.test(
    classOrId,
  );
  const hasBreadcrumbPositionKeyword =
    !hasPositionContentCue && /(^|[\s_-])position([\s_-]|$)/.test(classOrId);

  return hasNavigationKeyword || hasBreadcrumbPositionKeyword;
}

function hasBoilerplateRegionAncestor($: any, element: unknown): boolean {
  if ($(element).parents("aside").length > 0) {
    return true;
  }

  const classOrId = [
    $(element).attr("class"),
    $(element).attr("id"),
    $(element)
      .parents()
      .map(
        (_index: number, parent: unknown) =>
          `${$(parent).attr("class") ?? ""} ${$(parent).attr("id") ?? ""}`,
      )
      .get()
      .join(" "),
  ]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();

  return /(^|[\s_-])(sidebar|side-bar|sidepanel|side-panel|share|social|qrcode|qr-code)([\s_-]|$)/.test(
    classOrId,
  );
}

function extractTableCells($: any, element: unknown): string[][] {
  return $(element)
    .find("tr")
    .toArray()
    .map((row: unknown) =>
      $(row)
        .find("th,td")
        .toArray()
        .map((cell: unknown) => normalizeText($(cell).text()) ?? ""),
    );
}

function serializeResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  return Object.entries(headers).reduce<Record<string, string | string[]>>((result, [key, value]) => {
    if (value == null) {
      return result;
    }
    result[key.toLowerCase()] = Array.isArray(value) ? value : String(value);
    return result;
  }, {});
}

function readHeaderValue(
  headers: Record<string, string | string[]>,
  key: string,
): string | null {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function toJsonLines(records: ReadonlyArray<object>): string {
  if (records.length === 0) {
    return "";
  }
  return `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized == null) {
    return null;
  }

  const stripped = stripKnownTrackingResidue(normalized).replace(/\s+/g, " ").trim();
  return normalizeSplitCardDateText(stripped);
}

function normalizeSplitCardDateText(value: string): string {
  const splitDateMatch = value.match(/^(?<day>\d{1,2})(?<year>20\d{2})[./-](?<month>\d{1,2})$/);
  if (!splitDateMatch?.groups) {
    return value;
  }

  const day = splitDateMatch.groups.day.padStart(2, "0");
  const month = splitDateMatch.groups.month.padStart(2, "0");
  return `${splitDateMatch.groups.year}-${month}-${day}`;
}

function normalizePageTitle(value: string | null, siteDisplayName: string): string {
  const normalized = normalizeText(value) ?? "";
  if (normalized.length === 0) {
    return "";
  }

  const segments = normalized
    .split(/[-|｜]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const first = segments[0] ?? normalized;
  if (segments.length > 1 && segments.some((item) => item.toLowerCase() === siteDisplayName.toLowerCase())) {
    return first;
  }
  return first;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractCanonicalPublishedAt(input: {
  html: CheerioCrawlingContext["$"];
  pageFamily: OfficialWebPageFamily;
}): string | null {
  if (!PUBLISHED_AT_ALLOWED_PAGE_FAMILIES.has(input.pageFamily)) {
    return null;
  }

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="article:published"]',
    'meta[name="publishdate"]',
    'meta[name="pubdate"]',
    'meta[name="dc.date"]',
    'meta[name="dc.date.issued"]',
  ];
  for (const selector of metaSelectors) {
    for (const element of input.html(selector).toArray() as any[]) {
      const content = normalizeOptionalString(String(input.html(element).attr("content") ?? ""));
      const publishedAt = parseCanonicalPublishedAt(content);
      if (publishedAt != null) {
        return publishedAt;
      }
    }
  }

  for (const element of input.html("time[datetime]").toArray() as any[]) {
    const datetime = normalizeOptionalString(String(input.html(element).attr("datetime") ?? ""));
    const publishedAt = parseCanonicalPublishedAt(datetime);
    if (publishedAt != null) {
      return publishedAt;
    }
  }

  for (const element of input.html("time,span,div,p,li").toArray() as any[]) {
    if (!hasPublicationMetadataContext(input.html, element)) {
      continue;
    }
    const text = normalizeText(input.html(element).text());
    if (text == null) {
      continue;
    }
    if (!containsPublicationLabel(text) && !looksLikeDateText(text)) {
      continue;
    }
    const publishedAt = parseCanonicalPublishedAt(text);
    if (publishedAt != null) {
      return publishedAt;
    }
  }

  return null;
}

function hasPublicationMetadataContext($: any, element: unknown): boolean {
  const candidates = [element, ...($(element).parents().slice(0, 3).toArray() as unknown[])];
  return candidates.some((candidate) => {
    const classOrId = `${$(candidate).attr("class") ?? ""} ${$(candidate).attr("id") ?? ""}`
      .toLowerCase()
      .replace(/[_-]/g, " ");
    return /(publish|发布时间|date|time|arc info|article info|news time|fz time)/.test(classOrId);
  });
}

function containsPublicationLabel(text: string): boolean {
  return /(发布时间|发布于|发布:|发布：|更新时间|更新于|日期:|日期：|时间:|时间：)/.test(text);
}

function parseCanonicalPublishedAt(value: string | null): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.replace(/[：]/g, ":").replace(/\s+/g, " ").trim();
  const isoLikeMatch = normalized.match(
    /\b(20\d{2}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/i,
  );
  if (isoLikeMatch?.[1]) {
    const date = new Date(isoLikeMatch[1]);
    if (!Number.isNaN(date.getTime())) {
      return formatDateToShanghaiIso(date);
    }
  }

  const match = normalized.match(
    /(20\d{2})[./年-](\d{1,2})[./月-](\d{1,2})(?:[日号]?)?(?:\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (!match) {
    return null;
  }

  return formatShanghaiIsoFromParts({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] != null ? Number(match[4]) : 0,
    minute: match[5] != null ? Number(match[5]) : 0,
    second: match[6] != null ? Number(match[6]) : 0,
  });
}

function formatDateToShanghaiIso(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return formatShanghaiIsoFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  });
}

function formatShanghaiIsoFromParts(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): string {
  return [
    `${String(input.year).padStart(4, "0")}-${String(input.month).padStart(2, "0")}-${String(input.day).padStart(2, "0")}`,
    `T${String(input.hour).padStart(2, "0")}:${String(input.minute).padStart(2, "0")}:${String(input.second).padStart(2, "0")}${SHANGHAI_TIMEZONE_OFFSET}`,
  ].join("");
}

function resolveOptionalUrl(href: string | null | undefined, baseUrl: string): string | null {
  if (typeof href !== "string" || href.trim().length === 0) {
    return null;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function resolveAnchorTargetUrl($: any, element: unknown, baseUrl: string): string | null {
  const href = normalizeOptionalString(String($(element).attr("href") ?? ""));
  if (href != null && !/^javascript:/i.test(href)) {
    return resolveOptionalUrl(href, baseUrl);
  }

  const onclick = normalizeOptionalString(String($(element).attr("onclick") ?? ""));
  if (onclick == null) {
    return null;
  }

  const onclickTarget = extractOnclickNavigationTarget(onclick);
  return onclickTarget == null ? null : resolveOptionalUrl(onclickTarget, baseUrl);
}

function extractOnclickNavigationTarget(onclick: string): string | null {
  const patterns = [
    /opennews\(\s*(['"])(?<url>.+?)\1\s*\)/i,
    /(?:window\.)?open\(\s*(['"])(?<url>.+?)\1/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*(['"])(?<url>.+?)\1/i,
    /(?:window\.)?location\.(?:assign|replace)\(\s*(['"])(?<url>.+?)\1\s*\)/i,
  ];

  for (const pattern of patterns) {
    const match = onclick.match(pattern);
    const candidate = match?.groups?.url;
    const normalized = normalizeOptionalString(candidate);
    if (normalized != null) {
      return normalized;
    }
  }

  return null;
}

function stripKnownTrackingResidue(value: string): string {
  return value.replace(/_showDynClickBatch\s*\([^)]*\)/g, " ");
}

function compactHeadingPath(value: Array<string | null | undefined>): string[] {
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function countRepeatedCandidateTexts(
  candidates: ReadonlyArray<Pick<ExtractedBlockCandidate, "blockRole" | "textNormalized" | "isMainContent">>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const candidate of candidates) {
    if (!isEligibleRepeatedCandidate(candidate)) {
      continue;
    }
    const text = candidate.textNormalized;
    if (text == null || text.length < 2) {
      continue;
    }
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  return counts;
}

function summarizePageSignals(input: {
  contentBlocks: OfficialWebContentBlockRow[];
  html: CheerioCrawlingContext["$"];
  responseBody: string;
}): OfficialWebPageSignalSummary {
  const mainBlocks = input.contentBlocks.filter((item) => item.isMainContent);
  const allTables = input.contentBlocks.filter((item) => item.blockRole === "table");
  const mainTables = mainBlocks.filter((item) => item.blockRole === "table");
  const listingTableCount = allTables.filter((item) => classifyTableBlock(item) === "listing").length;
  const galleryTableCount = allTables.filter((item) => classifyTableBlock(item) === "gallery").length;
  const mainContentCharacterCount = mainBlocks.reduce(
    (total, item) => total + (item.textNormalized?.length ?? 0),
    0,
  );

  return {
    mainContentBlockCount: mainBlocks.length,
    mainHeadingCount: mainBlocks.filter((item) => item.blockRole === "heading").length,
    mainParagraphCount: mainBlocks.filter((item) => item.blockRole === "paragraph").length,
    mainListItemCount: mainBlocks.filter((item) => item.blockRole === "list_item").length,
    mainLinkCount: mainBlocks.filter((item) => item.blockRole === "link").length,
    shortMainLinkCount: mainBlocks.filter(
      (item) => item.blockRole === "link" && isShortDirectoryLinkText(item.textNormalized),
    ).length,
    mainTableCount: mainTables.length,
    listingTableCount,
    galleryTableCount,
    contactLikeMainBlockCount: mainBlocks.filter((item) => isContactLikeText(item.textNormalized)).length,
    dateLikeMainBlockCount: mainBlocks.filter((item) => containsDateLikeText(item.textNormalized)).length,
    repeatedNonMainBlockCount: input.contentBlocks.filter((item) => item.isRepeatedCandidate).length,
    mainContentCharacterCount,
    zeroMainContent: mainBlocks.length === 0,
    structuralShellSignal:
      mainBlocks.length === 0 && looksLikeStructuralShell(input.html),
    dynamicShellSignal:
      mainBlocks.length === 0 && looksLikeDynamicShell(input.responseBody),
  };
}

function classifyPageFamily(input: {
  hostPolicy: OfficialWebHostPolicy;
  finalUrl: string;
  pageTitleNormalized: string;
  pageSignals: OfficialWebPageSignalSummary;
}): PageFamilyClassification {
  const titleHint = input.pageTitleNormalized;
  const portalTitleHint = /(新闻网|新闻中心|网站首页|首页)/.test(titleHint);
  const sitemapHint =
    /(网站地图|站点地图|网站导航|站点导航)/.test(titleHint) ||
    /\/(sitemap|map|wzdh|wldh)([./_-]|$)/i.test(input.finalUrl);
  const galleryHint = /(图片|图集|风采|相册|画廊|gallery)/i.test(titleHint);
  const directoryHint =
    /(通讯录|机构|部门|办公室|院领导|领导|联系方式|联系我们|学院介绍|学院简介|概况|教师|师资)/.test(titleHint);
  const thinDirectoryTitleHint =
    /(通讯录|机构设置?|部门|办公室|院领导|领导|教师|师资|导师|教授|组织员|行政机构|教学部|友情链接|队伍|名录)/.test(
      titleHint,
    );
  const contactHint = /(联系方式|联系我们|联系电话|电话|邮箱|地址|传真|contact)/i.test(titleHint);
  const denseDateLinkListingSignal =
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.mainLinkCount >= 4 &&
    input.pageSignals.dateLikeMainBlockCount >= Math.min(4, input.pageSignals.mainLinkCount) &&
    input.pageSignals.mainParagraphCount >= input.pageSignals.mainLinkCount;
  const mixedCardDateLinkListingSignal =
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.mainLinkCount >= 4 &&
    input.pageSignals.dateLikeMainBlockCount >= Math.min(4, input.pageSignals.mainLinkCount) &&
    input.pageSignals.mainParagraphCount >= Math.ceil(input.pageSignals.mainLinkCount / 2) &&
    input.pageSignals.mainParagraphCount < input.pageSignals.mainLinkCount;
  const sparseDateLinkListingSignal =
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.mainListItemCount >= 1 &&
    input.pageSignals.mainLinkCount >= 1 &&
    input.pageSignals.dateLikeMainBlockCount >= 1 &&
    input.pageSignals.mainParagraphCount === 0 &&
    input.pageSignals.mainContentCharacterCount <= 80;
  const cardDateLinkListingSignal =
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.mainLinkCount >= 2 &&
    input.pageSignals.dateLikeMainBlockCount >= Math.min(2, input.pageSignals.mainLinkCount) &&
    input.pageSignals.mainParagraphCount === input.pageSignals.dateLikeMainBlockCount;
  const portalCardAggregateListingSignal =
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.mainHeadingCount >= 3 &&
    input.pageSignals.mainLinkCount >= 2 &&
    input.pageSignals.mainParagraphCount >= 2 &&
    input.pageSignals.mainParagraphCount <= input.pageSignals.mainHeadingCount &&
    input.pageSignals.repeatedNonMainBlockCount >= 20 &&
    (portalTitleHint || /\/$/.test(input.finalUrl));
  const thinDirectoryStructureSignal =
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.dateLikeMainBlockCount === 0 &&
    input.pageSignals.mainParagraphCount <= 1 &&
    input.pageSignals.mainContentCharacterCount <= 64 &&
    (input.pageSignals.mainHeadingCount >= 2 ||
      input.pageSignals.mainLinkCount >= 1 ||
      input.pageSignals.mainListItemCount >= 1 ||
      input.pageSignals.contactLikeMainBlockCount >= 1);
  const denseDirectRosterDirectorySignal =
    thinDirectoryTitleHint &&
    input.pageSignals.mainTableCount === 0 &&
    input.pageSignals.dateLikeMainBlockCount === 0 &&
    input.pageSignals.mainParagraphCount === 0 &&
    input.pageSignals.mainLinkCount >= 6 &&
    input.pageSignals.mainListItemCount >= 4 &&
    input.pageSignals.shortMainLinkCount >=
      Math.max(6, Math.ceil(input.pageSignals.mainLinkCount * 0.6));

  if (input.pageSignals.zeroMainContent && input.pageSignals.dynamicShellSignal) {
    return {
      pageFamily: "dynamic_shell_page",
      confidence: 0.98,
      reason: "zero_main_content_with_dynamic_shell_signal",
    };
  }

  if (input.pageSignals.zeroMainContent && input.pageSignals.structuralShellSignal) {
    return {
      pageFamily: "structural_shell_page",
      confidence: 0.92,
      reason: "zero_main_content_with_static_structural_shell_signal",
    };
  }

  if (input.pageSignals.zeroMainContent && input.pageSignals.repeatedNonMainBlockCount >= 40) {
    return {
      pageFamily: "structural_shell_page",
      confidence: 0.82,
      reason: "zero_main_content_with_repeated_navigation_shell_signal",
    };
  }

  if (sitemapHint && input.pageSignals.mainLinkCount >= 4) {
    return {
      pageFamily: "sitemap_navigation_page",
      confidence: 0.97,
      reason: "sitemap_keyword_and_dense_main_links",
    };
  }

  if (
    input.pageSignals.listingTableCount > 0 ||
    (input.pageSignals.mainTableCount === 0 &&
      (input.pageSignals.mainLinkCount >= 2 || input.pageSignals.mainListItemCount >= 2) &&
      input.pageSignals.dateLikeMainBlockCount >= 1 &&
      input.pageSignals.mainParagraphCount <= 2) ||
    denseDateLinkListingSignal ||
    mixedCardDateLinkListingSignal ||
    sparseDateLinkListingSignal ||
    cardDateLinkListingSignal ||
    portalCardAggregateListingSignal
  ) {
    return {
      pageFamily: "listing_page",
      confidence:
        input.pageSignals.listingTableCount > 0
          ? 0.95
          : denseDateLinkListingSignal
            ? 0.88
            : mixedCardDateLinkListingSignal
              ? 0.86
            : portalCardAggregateListingSignal
              ? 0.85
            : cardDateLinkListingSignal
              ? 0.84
            : sparseDateLinkListingSignal
              ? 0.82
              : 0.86,
      reason:
        input.pageSignals.listingTableCount > 0
          ? "listing_table_signal"
          : denseDateLinkListingSignal
            ? "dated_link_listing_signal"
            : mixedCardDateLinkListingSignal
              ? "mixed_card_date_link_listing_signal"
            : portalCardAggregateListingSignal
              ? "portal_card_aggregate_listing_signal"
            : cardDateLinkListingSignal
              ? "card_date_link_listing_signal"
            : sparseDateLinkListingSignal
              ? "single_entry_dated_listing_signal"
              : "date_dense_link_listing_signal",
    };
  }

  if (
    input.pageSignals.galleryTableCount > 0 ||
    (galleryHint &&
      input.pageSignals.mainLinkCount >= 2 &&
      input.pageSignals.dateLikeMainBlockCount === 0)
  ) {
    return {
      pageFamily: "gallery_page",
      confidence: input.pageSignals.galleryTableCount > 0 ? 0.96 : 0.84,
      reason: input.pageSignals.galleryTableCount > 0 ? "gallery_table_signal" : "gallery_keyword_and_main_links",
    };
  }

  if (input.pageSignals.mainTableCount > 0) {
    if (
      directoryHint ||
      input.pageSignals.contactLikeMainBlockCount >= 2 ||
      input.hostPolicy.publicKind === "directory_site"
    ) {
      return {
        pageFamily: "directory_page",
        confidence:
          directoryHint || input.pageSignals.contactLikeMainBlockCount >= 2 ? 0.9 : 0.78,
        reason:
          directoryHint || input.pageSignals.contactLikeMainBlockCount >= 2
            ? "directory_table_signal"
            : "directory_site_table_fallback",
      };
    }
    return {
      pageFamily: "data_table_page",
      confidence: 0.88,
      reason: "main_table_signal",
    };
  }

  if (
    input.pageSignals.contactLikeMainBlockCount >= 2 &&
    input.pageSignals.mainContentBlockCount <= 5 &&
    input.pageSignals.mainParagraphCount <= 2
  ) {
    if (directoryHint || input.hostPolicy.publicKind === "directory_site") {
      return {
        pageFamily: "directory_page",
        confidence: 0.82,
        reason: "contact_dense_directory_signal",
      };
    }
    return {
      pageFamily: "contact_widget_page",
      confidence: contactHint ? 0.88 : 0.8,
      reason: contactHint ? "contact_keyword_and_dense_contact_blocks" : "dense_contact_blocks",
    };
  }

  if (thinDirectoryTitleHint && thinDirectoryStructureSignal) {
    return {
      pageFamily: "directory_page",
      confidence: input.pageSignals.mainHeadingCount >= 2 ? 0.84 : 0.8,
      reason:
        input.pageSignals.mainHeadingCount >= 2
          ? "thin_directory_heading_structure_signal"
          : "thin_directory_link_structure_signal",
    };
  }

  if (denseDirectRosterDirectorySignal) {
    return {
      pageFamily: "directory_page",
      confidence: 0.82,
      reason: "dense_short_link_directory_signal",
    };
  }

  if (
    (input.pageSignals.mainParagraphCount >= 2 ||
      (input.pageSignals.mainParagraphCount >= 1 &&
        input.pageSignals.mainListItemCount >= 1 &&
        input.pageSignals.mainContentBlockCount >= 3)) &&
    input.pageSignals.mainContentCharacterCount >= 24 &&
    input.pageSignals.mainLinkCount <= Math.max(4, input.pageSignals.mainParagraphCount + input.pageSignals.mainListItemCount)
  ) {
    return {
      pageFamily: "article_detail",
      confidence: 0.9,
      reason: "paragraph_dominant_main_content",
    };
  }

  if (
    input.hostPolicy.publicKind === "directory_site" &&
    (directoryHint || input.pageSignals.mainLinkCount >= 4 || input.pageSignals.contactLikeMainBlockCount >= 1)
  ) {
    return {
      pageFamily: "directory_page",
      confidence: directoryHint ? 0.8 : 0.72,
      reason: directoryHint ? "directory_site_keyword_signal" : "directory_site_fallback",
    };
  }

  if (input.pageSignals.mainLinkCount >= 3 && input.pageSignals.mainParagraphCount <= 2) {
    return {
      pageFamily: "listing_page",
      confidence: 0.74,
      reason: "dense_main_link_fallback",
    };
  }

  return {
    pageFamily: "generic_content_page",
    confidence: 0.65,
    reason: "generic_content_fallback",
  };
}

function classifyTableBlock(block: Pick<OfficialWebContentBlockRow, "tableHtml" | "tableCells">): "listing" | "gallery" | "data" | null {
  const tableHtml = block.tableHtml?.toLowerCase() ?? "";
  const tableCells = block.tableCells ?? [];
  if (tableHtml.length === 0 && tableCells.length === 0) {
    return null;
  }

  const anchorCount = (tableHtml.match(/<a\b/g) ?? []).length;
  const imageCount = (tableHtml.match(/<(img|picture|svg)\b/g) ?? []).length;
  const cellTexts = tableCells.flat().filter((item) => item.length > 0);
  const dateLikeCellCount = cellTexts.filter((item) => looksLikeDateText(item)).length;
  const headerText = (tableCells[0] ?? []).join(" ");

  if (anchorCount >= 2 && imageCount > 0 && dateLikeCellCount === 0) {
    return "gallery";
  }

  const maxColumnCount = tableCells.reduce((max, row) => Math.max(max, row.length), 0);

  if (
    anchorCount >= 2 &&
    ((/(标题|题名)/.test(headerText) && /(时间|日期|发布时间|更新)/.test(headerText)) ||
      (dateLikeCellCount >= 2 && maxColumnCount <= 2))
  ) {
    return "listing";
  }

  return tableCells.length > 0 ? "data" : null;
}

function isRepeatedCandidate(
  candidate: Pick<ExtractedBlockCandidate, "blockRole" | "textNormalized" | "isMainContent">,
  counts: ReadonlyMap<string, number>,
): boolean {
  if (!isEligibleRepeatedCandidate(candidate)) {
    return false;
  }
  const text = candidate.textNormalized;
  if (text == null || text.length < 2) {
    return false;
  }
  return (counts.get(text) ?? 0) > 1;
}

function isEligibleRepeatedCandidate(
  candidate: Pick<ExtractedBlockCandidate, "blockRole" | "isMainContent">,
): boolean {
  return candidate.blockRole !== "title" && !candidate.isMainContent;
}

function hasDateLikeDescendant($: any, element: unknown): boolean {
  const descendants = $(element).find("time,span").toArray() as unknown[];
  return descendants.some((candidate) => {
    const text = normalizeText($(candidate).text());
    if (text == null) {
      return false;
    }
    return looksLikeDateText(text);
  });
}

function hasDirectoryRosterContext($: any, element: unknown): boolean {
  const listItem = $(element).closest("li,dt");
  if (listItem.length === 0) {
    return false;
  }

  const contextFragments = [
    listItem.parent().prevAll().slice(0, 3).text(),
    listItem
      .parents("section,div,main,article")
      .slice(0, 4)
      .map((_index: number, candidate: unknown) => {
        const anchorText = $(candidate)
          .children("h1,h2,h3,h4,h5,h6,.list-right-l,.list-right-tt,.teacher-title,.directory-title")
          .first()
          .text();
        const previousText = $(candidate).prevAll().slice(0, 2).text();
        return `${anchorText} ${previousText}`;
      })
      .get()
      .join(" "),
  ];
  const contextText = normalizeText(contextFragments.join(" "));
  if (contextText == null) {
    return false;
  }

  return /(师资|教师|教授|导师|学系|法学系|队伍|名录|faculty|staff|directory|roster)/i.test(contextText);
}

function isLikelyMainContentTable(
  $: any,
  element: unknown,
  hasMainContentAncestor: boolean,
): boolean {
  const maxColumnCount = $(element)
    .find("tr")
    .toArray()
    .reduce((max: number, row: unknown) => Math.max(max, $(row).find("th,td").length), 0);

  if (hasMainContentAncestor && maxColumnCount >= 3) {
    return true;
  }

  if (isLikelyListingTable($, element) || isLikelyGalleryTable($, element)) {
    return false;
  }

  if (hasMainContentAncestor) {
    return true;
  }

  return normalizeText(extractElementText($, element)) != null;
}

function isLikelyListingTable($: any, element: unknown): boolean {
  const table = $(element);
  const rowElements = table.find("tr").toArray() as unknown[];
  const linkedRowCount = rowElements.filter((row) => tableRowContainsLinks($, row)).length;
  if (linkedRowCount < 2) {
    return false;
  }

  const classOrId = [table.attr("class"), table.attr("id")]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
  if (/(^|[\s_-])((main|news|notice|bulletin|article|content)[\s_-]*)?list(table)?([\s_-]|$)/.test(classOrId)) {
    return true;
  }

  const headerText = normalizeText(
    rowElements
      .flatMap((row) => $(row).find("th").toArray() as unknown[])
      .map((cell) => $(cell).text())
      .join(" "),
  );
  if (
    headerText != null &&
    /(标题|题名)/.test(headerText) &&
    /(时间|日期|发布时间)/.test(headerText)
  ) {
    return true;
  }

  const dateLikeCellCount = table
    .find("th,td")
    .toArray()
    .filter((cell: unknown) => {
      const text = normalizeText($(cell).text());
      return text != null && looksLikeDateText(text);
    }).length;

  return dateLikeCellCount >= Math.min(linkedRowCount, 2);
}

function isLikelyGalleryTable($: any, element: unknown): boolean {
  const table = $(element);
  const anchorCount = table.find("a[href]").length;
  if (anchorCount < 2) {
    return false;
  }

  if (table.find("img,picture,svg").length === 0) {
    return false;
  }

  if (table.find("th").length > 0) {
    return false;
  }

  const dateLikeCellCount = table
    .find("td,span,time")
    .toArray()
    .filter((candidate: unknown) => {
      const text = normalizeText($(candidate).text());
      return text != null && looksLikeDateText(text);
    }).length;

  return dateLikeCellCount === 0;
}

function shouldUpdateHeadingPath(
  $: any,
  element: unknown,
  isBoilerplate: boolean,
): boolean {
  if (isBoilerplate) {
    return false;
  }

  const anchors = $(element).find("a[href]").toArray() as unknown[];
  if (anchors.length !== 1) {
    return true;
  }

  const headingText = normalizeText(extractElementText($, element));
  const anchorText = normalizeText(extractElementText($, anchors[0]));
  if (headingText == null || anchorText == null || headingText !== anchorText) {
    return true;
  }

  const href = normalizeOptionalString($(anchors[0]).attr("href"));
  if (href == null) {
    return true;
  }

  return href.startsWith("#") || href.startsWith("javascript:");
}

function computeTextDensity(segment: string | null, whole: string): number {
  if (segment == null || segment.length === 0 || whole.length === 0) {
    return 0;
  }
  return segment.length / whole.length;
}

function isContactLikeText(text: string | null | undefined): boolean {
  if (text == null || text.length === 0) {
    return false;
  }

  return (
    /(电话|联系电话|传真|邮箱|电子邮箱|地址|邮编|办公室|办公电话|contact|e-?mail)/i.test(text) ||
    /010-\d{7,8}/.test(text) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
  );
}

function isShortDirectoryLinkText(text: string | null | undefined): boolean {
  const normalized = normalizeText(text);
  if (normalized == null) {
    return false;
  }

  return (
    normalized.length >= 2 &&
    normalized.length <= 8 &&
    !containsDateLikeText(normalized) &&
    !/\d/.test(normalized) &&
    !isGenericDetailLinkText(normalized)
  );
}

function looksLikeDynamicShell(responseBody: string): boolean {
  const normalized = responseBody.toLowerCase();
  const scriptCount = (normalized.match(/<script\b/g) ?? []).length;
  const hasMountNode =
    /id=["'](app|root|__next|nuxt)["']/.test(normalized) ||
    /data-v-app/.test(normalized);
  const hasClientFetchSignal =
    /(fetch\(|axios|xmlhttprequest|reactdom|createapp\(|window\.__|jsonp|\.load\()/i.test(
      responseBody,
    );

  return scriptCount >= 1 && (hasMountNode || hasClientFetchSignal);
}

function looksLikeStructuralShell(html: CheerioCrawlingContext["$"]): boolean {
  const containers = analyzeVisibleContentContainers(html);
  if (containers.length === 0) {
    return false;
  }

  const maxTextLength = containers.reduce((max, item) => Math.max(max, item.textLength), 0);
  const hasStructuredShellCue = containers.some(
    (item) =>
      item.mediaCount > 0 ||
      item.listCount > 0 ||
      item.hasPagination ||
      containers.length >= 2,
  );

  return maxTextLength <= 24 && hasStructuredShellCue;
}

function analyzeVisibleContentContainers(html: CheerioCrawlingContext["$"]): VisibleContentContainerStats[] {
  const $ = html as any;
  const candidateSelectors = [
    "#vsb_content",
    "#maincontent",
    ".right-con",
    ".text-list",
    ".list_content",
    ".wape-right",
    ".ny-right",
    ".lba",
    ".detail-shell",
    ".panel-body",
    ".news-panel",
    ".notice-panel",
    ".page-shell",
    ".homepage-shell",
    "main",
    "article",
  ];
  const pruneSelectors = [
    "script",
    "style",
    "noscript",
    "template",
    "nav",
    "header",
    "footer",
    "aside",
    ".position",
    ".breadcrumb",
    ".biaoTi",
    ".pagination",
    ".pb_sys_common",
    ".p_pages",
    ".leftNav",
    ".channl-menu",
    ".lr",
    ".sidebar",
  ].join(", ");
  const containers: unknown[] = [];

  for (const selector of candidateSelectors) {
    for (const element of $(selector).toArray() as unknown[]) {
      if (containers.includes(element)) {
        continue;
      }
      if (
        hasNavigationAncestor($, element) ||
        hasBoilerplateRegionAncestor($, element) ||
        hasTagAncestor($, element, "header") ||
        hasTagAncestor($, element, "footer") ||
        hasTagAncestor($, element, "aside")
      ) {
        continue;
      }
      containers.push(element);
    }
  }

  for (const element of $("div,section,main,article").toArray() as unknown[]) {
    if (containers.includes(element)) {
      continue;
    }
    if (
      hasNavigationAncestor($, element) ||
      hasBoilerplateRegionAncestor($, element) ||
      hasTagAncestor($, element, "header") ||
      hasTagAncestor($, element, "footer") ||
      hasTagAncestor($, element, "aside")
    ) {
      continue;
    }

    const classOrId = `${$(element).attr("class") ?? ""} ${$(element).attr("id") ?? ""}`.toLowerCase();
    if (
      !/(^|[\s_-])(content|main|detail|panel|box|txt|article|post)([\s_-]|$)/.test(classOrId) &&
      !looksLikeRepeatedCardClusterContainer($, element)
    ) {
      continue;
    }

    containers.push(element);
  }

  if (containers.length === 0) {
    return [];
  }

  return containers.map((element) => {
    const clone = $(element).clone();
    clone.find(pruneSelectors).remove();
    const textLength = (normalizeText(clone.text()) ?? "").length;
    const dateLikeTextCount = clone
      .find("div,span,time,p,li,dt,dd")
      .toArray()
      .filter((candidate: unknown) => {
        const text = normalizeText($(candidate).text());
        return text != null && containsDateLikeText(text);
      }).length;
    const hasPagination =
      clone.is(".pagination,.pb_sys_common,.p_pages") ||
      clone.find(".pagination,.pb_sys_common,.p_pages").length > 0;
    const repeatedCardChildCount = countRepeatedCardChildren($, element);

    return {
      element,
      textLength,
      mediaCount: clone.find("img,picture,svg,video,iframe").length,
      listCount: clone.find("li").length,
      anchorCount: clone.find("a[href]").length,
      dateLikeTextCount,
      repeatedCardChildCount,
      hasPagination,
    };
  });
}

function selectRecoverableContentContainers(
  $: any,
  containers: VisibleContentContainerStats[],
): VisibleContentContainerStats[] {
  const strongContainers = containers.filter(
    (item) =>
      item.textLength >= 80 ||
      item.repeatedCardChildCount >= 2 ||
      (item.anchorCount >= 3 &&
        (
          item.dateLikeTextCount >= 2 ||
          item.listCount >= 2 ||
          item.mediaCount > 0 ||
          item.repeatedCardChildCount >= 2
        )),
  );

  const listingLikeContainers = strongContainers.filter((item) => isListingLikeRecoveryContainer(item));
  if (listingLikeContainers.length > 0) {
    return listingLikeContainers.filter(
      (item) =>
        !listingLikeContainers.some(
          (candidate) =>
            candidate !== item &&
            $(candidate.element).parents().toArray().includes(item.element),
        ),
    );
  }

  return strongContainers.filter(
    (item) =>
      !strongContainers.some(
        (candidate) =>
          candidate !== item &&
          candidate.textLength >= item.textLength / 2 &&
          $(candidate.element).parents().toArray().includes(item.element),
      ),
  );
}

function isListingLikeRecoveryContainer(container: VisibleContentContainerStats): boolean {
  return (
    container.anchorCount >= 3 &&
    (
      container.dateLikeTextCount >= 2 ||
      container.listCount >= 2 ||
      container.mediaCount > 0 ||
      container.repeatedCardChildCount >= 2
    )
  );
}

function looksLikeRepeatedCardClusterContainer($: any, element: unknown): boolean {
  return countRepeatedCardChildren($, element) >= 2;
}

function countRepeatedCardChildren($: any, element: unknown): number {
  const counts = new Map<string, number>();

  for (const child of $(element).children("div,section,article,li,dt,dd").toArray() as unknown[]) {
    if (!looksLikeRecoverableCardChild($, child)) {
      continue;
    }

    const signature = buildRepeatedChildSignature($, child);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  return [...counts.values()].reduce((max, count) => Math.max(max, count), 0);
}

function looksLikeRecoverableCardChild($: any, element: unknown): boolean {
  const candidate = $(element);
  const textNormalized = normalizeText(extractElementText($, element));
  if (textNormalized == null) {
    return false;
  }

  const anchorTexts: string[] = candidate
    .find("a[href]")
    .toArray()
    .map((anchor: unknown) => normalizeText(extractElementText($, anchor)))
    .filter((text: string | null): text is string => text != null);

  if (anchorTexts.length === 0) {
    return false;
  }

  const hasMeaningfulAnchorText = anchorTexts.some((text: string) => !isGenericDetailLinkText(text));
  if (!hasMeaningfulAnchorText) {
    return false;
  }

  return (
    containsDateLikeText(textNormalized) ||
    hasCardLikeStructure($, element) ||
    candidate.find("img,picture,video,svg").length > 0
  );
}

function buildRepeatedChildSignature($: any, element: unknown): string {
  const tagName = String($(element)[0]?.tagName ?? "").toLowerCase();
  const classTokens = String($(element).attr("class") ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const stableClassToken =
    classTokens.find((item) => /^[a-z][a-z0-9_-]{1,}$/.test(item) && !/^\d+$/.test(item)) ?? null;

  return stableClassToken == null ? `tag:${tagName}` : `class:${stableClassToken}`;
}

function isGenericDetailLinkText(text: string): boolean {
  return /^(查看详情|详情|更多|more|read more|learn more)\s*>?$/i.test(text.trim());
}

function shouldRecoverElement(
  $: any,
  element: unknown,
  tagName: string,
  container: VisibleContentContainerStats,
  baseUrl: string,
): boolean {
  const textNormalized = normalizeText(extractElementText($, element));
  if (textNormalized == null) {
    return false;
  }

  if (hasNavigationAncestor($, element) || hasBoilerplateRegionAncestor($, element) || hasTagAncestor($, element, "footer")) {
    return false;
  }

  if (tagName === "a") {
    return resolveAnchorTargetUrl($, element, baseUrl) != null;
  }

  if (tagName === "li" || tagName === "dt" || tagName === "dd") {
    return textNormalized.length >= 8 || containsDateLikeText(textNormalized);
  }

  if (/^h\d$/.test(tagName) || tagName === "p") {
    return textNormalized.length >= 8;
  }

  if (tagName === "div" || tagName === "section" || tagName === "article") {
    if (isListingLikeRecoveryContainer(container)) {
      if (!containsDateLikeText(textNormalized) || textNormalized.length > 24) {
        return false;
      }

      return $(element)
        .children("div,section,article,span,time,p")
        .toArray()
        .every((candidate: unknown) => {
          const childText = normalizeText(extractElementText($, candidate));
          return childText == null || !containsDateLikeText(childText);
        });
    }

    if (textNormalized.length < 24) {
      return false;
    }

    if ($(element).find("table").length > 0) {
      return false;
    }

    const hasSubstantialStructuredChild = $(element)
      .children("div,section,article,p,ul,ol,dl")
      .toArray()
      .some((candidate: unknown) => {
        const childText = normalizeText(extractElementText($, candidate));
        return childText != null && childText.length >= 24;
      });

    return !hasSubstantialStructuredChild;
  }

  if (tagName === "span" || tagName === "time") {
    return containsDateLikeText(textNormalized);
  }

  return false;
}

function resolveRecoveryBlockRole(tagName: string): OfficialWebContentBlockRow["blockRole"] {
  if (/^h\d$/.test(tagName)) {
    return "heading";
  }
  if (tagName === "a") {
    return "link";
  }
  if (tagName === "li" || tagName === "dt" || tagName === "dd") {
    return "list_item";
  }
  return "paragraph";
}

function looksLikeDateText(text: string): boolean {
  return (
    /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(text) ||
    /^\d{2}[-/.月]\d{2}/.test(text) ||
    /^(?:[一二三四五六七八九十]{1,3}|\d{1,2})月\s*\d{1,2}/.test(text)
  );
}

function containsDateLikeText(text: string | null | undefined): boolean {
  if (text == null || text.length === 0) {
    return false;
  }

  return (
    /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}[-/.月]\d{1,2}/.test(text) ||
    /(?:[一二三四五六七八九十]{1,3}|\d{1,2})月\s*\d{1,2}/.test(text)
  );
}

function tableRowContainsLinks($: any, row: unknown): boolean {
  return $(row).find("a[href]").length > 0;
}

function hasCardLikeStructure($: any, element: unknown): boolean {
  const candidate = $(element);
  if (candidate.find("img,picture,video,svg").length > 0) {
    return true;
  }

  const classOrId = [
    candidate.attr("class"),
    candidate.attr("id"),
    candidate
      .find("*")
      .map((_index: number, child: unknown) => `${$(child).attr("class") ?? ""} ${$(child).attr("id") ?? ""}`)
      .get()
      .join(" "),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /(card|news|video|thumb|pic|image|media|mask|swiper|slide|cover|txt|summary|excerpt|teaser)/.test(
    classOrId,
  );
}
