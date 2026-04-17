import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
  OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS,
  OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
  buildOfficialWebSourceArtifactKey,
  hashOfficialWebContent,
  type OfficialWebContentBlockRow,
  type OfficialWebPageManifest,
  type OfficialWebProviderPageExtraction,
  type OfficialWebQualityAuditDocument,
  type OfficialWebSourceTruthBundle,
} from "./official-web-core.ts";

import { normalizeCliArgs } from "./cli.ts";
import { OFFICIAL_WEB_PARSER_SLUG } from "./runtime-metadata.ts";

type PageArtifactRelativePath =
  | "capture/response.html"
  | "provider/cheerio-basic/page-extraction.json"
  | "provider/cheerio-basic/discovered-links.jsonl"
  | "source-truth/page-manifest.json"
  | "source-truth/content-blocks.jsonl";

export interface CollectorValidationIssue {
  severity: "error" | "warning";
  category: "correctness" | "quality";
  code:
    | "missing_run_artifact"
    | "bundle_parse_failed"
    | "missing_page_file"
    | "page_manifest_parse_failed"
    | "provider_parse_failed"
    | "content_blocks_parse_failed"
    | "quality_audit_parse_failed"
    | "quality_audit_page_count_mismatch"
    | "quality_audit_missing_page"
    | "page_family_mismatch"
    | "bundle_object_key_mismatch"
    | "manifest_identity_mismatch"
    | "response_body_hash_mismatch"
    | "block_count_mismatch"
    | "content_block_identity_mismatch"
    | "quality_gate_review"
    | "quality_gate_fail";
  message: string;
}

export interface CollectorValidationReport {
  valid: boolean;
  outputDir: string;
  issues: CollectorValidationIssue[];
  counts: {
    bundlePages: number;
    errors: number;
    warnings: number;
  };
}

const REQUIRED_LOCAL_RUN_ARTIFACTS = [
  ...OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS,
  OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
  OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
] as const;

export async function validateCollectorOutput(outputDir: string): Promise<CollectorValidationReport> {
  const issues: CollectorValidationIssue[] = [];

  for (const artifactName of REQUIRED_LOCAL_RUN_ARTIFACTS) {
    const artifactPath = resolve(outputDir, artifactName);
    if (!existsSync(artifactPath)) {
      issues.push({
        severity: "error",
        category: "correctness",
        code: "missing_run_artifact",
        message: `missing run artifact: ${artifactName}`,
      });
    }
  }

  const bundlePath = resolve(outputDir, OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT);
  if (!existsSync(bundlePath)) {
    return finalizeReport(outputDir, issues, 0);
  }

  let bundle: OfficialWebSourceTruthBundle;
  try {
    bundle = JSON.parse(readFileSync(bundlePath, "utf-8")) as OfficialWebSourceTruthBundle;
  } catch (error) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "bundle_parse_failed",
      message: `failed to parse source-truth bundle: ${formatError(error)}`,
    });
    return finalizeReport(outputDir, issues, 0);
  }

  for (const page of bundle.pages) {
    validateBundlePage(outputDir, page, issues);
  }

  const auditPath = resolve(outputDir, OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT);
  if (existsSync(auditPath)) {
    validateQualityAudit(auditPath, bundle, issues);
  }

  return finalizeReport(outputDir, issues, bundle.pages.length);
}

function validateBundlePage(
  outputDir: string,
  page: OfficialWebSourceTruthBundle["pages"][number],
  issues: CollectorValidationIssue[],
): void {
  const baseDir = resolve(outputDir, "source-assets", page.rawAssetId, page.rawVersionId);
  const pagePaths: Record<PageArtifactRelativePath, string> = {
    "capture/response.html": resolve(baseDir, "capture", "response.html"),
    "provider/cheerio-basic/page-extraction.json": resolve(
      baseDir,
      "provider",
      OFFICIAL_WEB_PARSER_SLUG,
      "page-extraction.json",
    ),
    "provider/cheerio-basic/discovered-links.jsonl": resolve(
      baseDir,
      "provider",
      OFFICIAL_WEB_PARSER_SLUG,
      "discovered-links.jsonl",
    ),
    "source-truth/page-manifest.json": resolve(baseDir, "source-truth", "page-manifest.json"),
    "source-truth/content-blocks.jsonl": resolve(baseDir, "source-truth", "content-blocks.jsonl"),
  };

  for (const [relativePath, absolutePath] of Object.entries(pagePaths) as Array<
    [PageArtifactRelativePath, string]
  >) {
    if (!existsSync(absolutePath)) {
      issues.push({
        severity: "error",
        category: "correctness",
        code: "missing_page_file",
        message: `missing page file for ${page.rawAssetId}/${page.rawVersionId}: ${relativePath}`,
      });
    }
  }

  assertBundleObjectKey(
    issues,
    page.pageManifestObjectKey,
    buildOfficialWebSourceArtifactKey({
      rawAssetId: page.rawAssetId,
      rawVersionId: page.rawVersionId,
      stage: "source-truth",
      filename: "page-manifest.json",
    }),
    page,
    "source-truth/page-manifest.json",
  );
  assertBundleObjectKey(
    issues,
    page.contentBlocksObjectKey,
    buildOfficialWebSourceArtifactKey({
      rawAssetId: page.rawAssetId,
      rawVersionId: page.rawVersionId,
      stage: "source-truth",
      filename: "content-blocks.jsonl",
    }),
    page,
    "source-truth/content-blocks.jsonl",
  );
  assertBundleObjectKey(
    issues,
    page.providerExtractionObjectKey,
    buildOfficialWebSourceArtifactKey({
      rawAssetId: page.rawAssetId,
      rawVersionId: page.rawVersionId,
      stage: "provider",
      parserSlug: OFFICIAL_WEB_PARSER_SLUG,
      filename: "page-extraction.json",
    }),
    page,
    "provider/cheerio-basic/page-extraction.json",
  );
  assertBundleObjectKey(
    issues,
    page.discoveredLinksObjectKey,
    buildOfficialWebSourceArtifactKey({
      rawAssetId: page.rawAssetId,
      rawVersionId: page.rawVersionId,
      stage: "provider",
      parserSlug: OFFICIAL_WEB_PARSER_SLUG,
      filename: "discovered-links.jsonl",
    }),
    page,
    "provider/cheerio-basic/discovered-links.jsonl",
  );
  assertBundleObjectKey(
    issues,
    page.responseHtmlObjectKey,
    buildOfficialWebSourceArtifactKey({
      rawAssetId: page.rawAssetId,
      rawVersionId: page.rawVersionId,
      stage: "capture",
      filename: "response.html",
    }),
    page,
    "capture/response.html",
  );

  if (existsSync(pagePaths["source-truth/page-manifest.json"])) {
    validatePageManifest(outputDir, page, pagePaths, issues);
  }

  if (existsSync(pagePaths["source-truth/content-blocks.jsonl"])) {
    validateContentBlocks(page, pagePaths["source-truth/content-blocks.jsonl"], issues);
  }

  if (existsSync(pagePaths["provider/cheerio-basic/page-extraction.json"])) {
    validateProviderExtraction(page, pagePaths["provider/cheerio-basic/page-extraction.json"], issues);
  }
}

function validatePageManifest(
  outputDir: string,
  page: OfficialWebSourceTruthBundle["pages"][number],
  pagePaths: Record<PageArtifactRelativePath, string>,
  issues: CollectorValidationIssue[],
): void {
  let manifest: OfficialWebPageManifest;
  try {
    manifest = JSON.parse(readFileSync(pagePaths["source-truth/page-manifest.json"], "utf-8")) as OfficialWebPageManifest;
  } catch (error) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "page_manifest_parse_failed",
      message: `failed to parse page manifest for ${page.rawAssetId}/${page.rawVersionId}: ${formatError(error)}`,
    });
    return;
  }

  if (
    manifest.rawAssetId !== page.rawAssetId ||
    manifest.rawVersionId !== page.rawVersionId ||
    manifest.normalizedCanonicalUrl !== page.normalizedCanonicalUrl
  ) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "manifest_identity_mismatch",
      message: `page manifest identity mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }

  if (manifest.pageFamily !== page.pageFamily) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "page_family_mismatch",
      message: `page manifest family mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }

  const responseHtml = existsSync(pagePaths["capture/response.html"])
    ? readFileSync(pagePaths["capture/response.html"], "utf-8")
    : null;
  if (responseHtml != null) {
    const computedHash = hashOfficialWebContent(responseHtml);
    if (
      computedHash !== manifest.responseBodyHash ||
      manifest.responseBodyHash !== page.responseBodyHash
    ) {
      issues.push({
        severity: "error",
        category: "correctness",
        code: "response_body_hash_mismatch",
        message: `response body hash mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
      });
    }
  }

  const bundlePath = resolve(outputDir, OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT);
  if (existsSync(bundlePath) && manifest.blockCount !== page.blockCount) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "block_count_mismatch",
      message: `bundle blockCount does not match page manifest for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }
}

function validateContentBlocks(
  page: OfficialWebSourceTruthBundle["pages"][number],
  contentBlocksPath: string,
  issues: CollectorValidationIssue[],
): void {
  let rows: OfficialWebContentBlockRow[];
  try {
    rows = parseJsonLines(contentBlocksPath) as OfficialWebContentBlockRow[];
  } catch (error) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "content_blocks_parse_failed",
      message: `failed to parse content blocks for ${page.rawAssetId}/${page.rawVersionId}: ${formatError(error)}`,
    });
    return;
  }

  if (rows.length !== page.blockCount) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "block_count_mismatch",
      message: `content block count mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }

  if (
    rows.some(
      (row) => row.rawAssetId !== page.rawAssetId || row.rawVersionId !== page.rawVersionId,
    )
  ) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "content_block_identity_mismatch",
      message: `content block identity mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }
}

function validateProviderExtraction(
  page: OfficialWebSourceTruthBundle["pages"][number],
  providerPath: string,
  issues: CollectorValidationIssue[],
): void {
  let extraction: OfficialWebProviderPageExtraction;
  try {
    extraction = JSON.parse(readFileSync(providerPath, "utf-8")) as OfficialWebProviderPageExtraction;
  } catch (error) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "provider_parse_failed",
      message: `failed to parse provider extraction for ${page.rawAssetId}/${page.rawVersionId}: ${formatError(error)}`,
    });
    return;
  }

  if (extraction.rawAssetId !== page.rawAssetId || extraction.rawVersionId !== page.rawVersionId) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "manifest_identity_mismatch",
      message: `provider extraction identity mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }

  if (extraction.pageFamily !== page.pageFamily) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "page_family_mismatch",
      message: `provider extraction family mismatch for ${page.rawAssetId}/${page.rawVersionId}`,
    });
  }
}

function validateQualityAudit(
  auditPath: string,
  bundle: OfficialWebSourceTruthBundle,
  issues: CollectorValidationIssue[],
): void {
  let audit: OfficialWebQualityAuditDocument;
  try {
    audit = JSON.parse(readFileSync(auditPath, "utf-8")) as OfficialWebQualityAuditDocument;
  } catch (error) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "quality_audit_parse_failed",
      message: `failed to parse quality audit: ${formatError(error)}`,
    });
    return;
  }

  if (audit.summary.totalPages !== bundle.pages.length || audit.pages.length !== bundle.pages.length) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "quality_audit_page_count_mismatch",
      message: "quality audit page count does not match source-truth bundle",
    });
  }

  const bundlePagesById = new Map<string, OfficialWebSourceTruthBundle["pages"][number]>(
    bundle.pages.map((page) => [`${page.rawAssetId}/${page.rawVersionId}`, page]),
  );

  for (const auditPage of audit.pages) {
    const key = `${auditPage.rawAssetId}/${auditPage.rawVersionId}`;
    const bundlePage = bundlePagesById.get(key);
    if (!bundlePage) {
      issues.push({
        severity: "error",
        category: "correctness",
        code: "quality_audit_missing_page",
        message: `quality audit references unknown page: ${key}`,
      });
      continue;
    }

    if (bundlePage.pageFamily !== auditPage.pageFamily) {
      issues.push({
        severity: "error",
        category: "correctness",
        code: "page_family_mismatch",
        message: `quality audit page family mismatch for ${key}`,
      });
    }

    for (const auditIssue of auditPage.issues) {
      issues.push({
        severity: auditIssue.severity === "fail" ? "error" : "warning",
        category: "quality",
        code: auditIssue.severity === "fail" ? "quality_gate_fail" : "quality_gate_review",
        message: `${key}: ${auditIssue.code}: ${auditIssue.message}`,
      });
    }
  }
}

function assertBundleObjectKey(
  issues: CollectorValidationIssue[],
  actual: string,
  expected: string,
  page: OfficialWebSourceTruthBundle["pages"][number],
  relativePath: string,
): void {
  if (actual !== expected) {
    issues.push({
      severity: "error",
      category: "correctness",
      code: "bundle_object_key_mismatch",
      message: `bundle object key mismatch for ${page.rawAssetId}/${page.rawVersionId}: ${relativePath}`,
    });
  }
}

function parseJsonLines(path: string): object[] {
  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0) {
    return [];
  }

  return raw.split("\n").map((line) => JSON.parse(line) as object);
}

function finalizeReport(
  outputDir: string,
  issues: CollectorValidationIssue[],
  bundlePages: number,
): CollectorValidationReport {
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    outputDir,
    issues,
    counts: {
      bundlePages,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
    },
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function printValidationReport(report: CollectorValidationReport): void {
  console.log(`official-web collector validation: ${report.valid ? "PASS" : "FAIL"}`);
  console.log(`outputDir: ${report.outputDir}`);
  console.log(`bundlePages: ${report.counts.bundlePages}`);
  console.log(`errors: ${report.counts.errors}`);
  console.log(`warnings: ${report.counts.warnings}`);
  for (const issue of report.issues) {
    console.log(`[${issue.severity}/${issue.category}/${issue.code}] ${issue.message}`);
  }
}

export async function validateMain(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: normalizeCliArgs(argv),
    options: {
      "output-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const outputDir = values["output-dir"];
  if (typeof outputDir !== "string" || outputDir.length === 0) {
    throw new Error("--output-dir is required");
  }

  const report = await validateCollectorOutput(outputDir);
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printValidationReport(report);
  }

  if (!report.valid) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  void validateMain();
}
