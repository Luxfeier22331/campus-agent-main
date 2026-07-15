import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Hex } from "ingest-core";

import {
	buildOfficialWebSourceArtifactKey,
	hashOfficialWebContent,
	OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
	type OfficialWebContentBlockRow,
	type OfficialWebPageManifest,
	type OfficialWebProviderPageExtraction,
	type OfficialWebSourceTruthBundle,
} from "./core/index.ts";
import { OFFICIAL_WEB_PARSER_SLUG } from "./runtime-metadata.ts";
import type { CollectorValidationIssue, PageArtifactRelativePath } from "./validate-shared.ts";
import { formatError, parseJsonLines } from "./validate-shared.ts";

export function validateBundlePage(
	outputDir: string,
	page: OfficialWebSourceTruthBundle["pages"][number],
	issues: CollectorValidationIssue[],
	options: { requireTargetLineage?: boolean } = {},
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

	for (const [relativePath, absolutePath] of Object.entries(pagePaths) as [
		PageArtifactRelativePath,
		string,
	][]) {
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
		page.pageManifestRef.objectKey,
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
		page.contentBlocksRef.objectKey,
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
		page.providerExtractionRef.objectKey,
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
		page.discoveredLinksRef.objectKey,
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
		page.responseHtmlRef.objectKey,
		buildOfficialWebSourceArtifactKey({
			rawAssetId: page.rawAssetId,
			rawVersionId: page.rawVersionId,
			stage: "capture",
			filename: "response.html",
		}),
		page,
		"capture/response.html",
	);

	for (const [ref, relativePath] of [
		[page.responseHtmlRef, "capture/response.html"],
		[page.providerExtractionRef, "provider/cheerio-basic/page-extraction.json"],
		[page.discoveredLinksRef, "provider/cheerio-basic/discovered-links.jsonl"],
		[page.pageManifestRef, "source-truth/page-manifest.json"],
		[page.contentBlocksRef, "source-truth/content-blocks.jsonl"],
	] as const) {
		const path = pagePaths[relativePath];
		if (!existsSync(path)) {
			continue;
		}
		const bytes = readFileSync(path);
		if (bytes.byteLength !== ref.byteSize || sha256Hex(bytes) !== ref.contentSha256) {
			issues.push({
				severity: "error",
				category: "correctness",
				code: "bundle_artifact_identity_mismatch",
				message: `bundle artifact identity mismatch for ${page.rawAssetId}/${page.rawVersionId}: ${relativePath}`,
			});
		}
	}

	if (existsSync(pagePaths["source-truth/page-manifest.json"])) {
		validatePageManifest(outputDir, page, pagePaths, issues, options);
	}

	if (existsSync(pagePaths["source-truth/content-blocks.jsonl"])) {
		validateContentBlocks(page, pagePaths["source-truth/content-blocks.jsonl"], issues);
	}

	if (existsSync(pagePaths["provider/cheerio-basic/page-extraction.json"])) {
		validateProviderExtraction(
			page,
			pagePaths["provider/cheerio-basic/page-extraction.json"],
			issues,
		);
	}
}

function validatePageManifest(
	outputDir: string,
	page: OfficialWebSourceTruthBundle["pages"][number],
	pagePaths: Record<PageArtifactRelativePath, string>,
	issues: CollectorValidationIssue[],
	options: { requireTargetLineage?: boolean },
): void {
	let manifest: OfficialWebPageManifest;
	try {
		manifest = JSON.parse(
			readFileSync(pagePaths["source-truth/page-manifest.json"], "utf-8"),
		) as OfficialWebPageManifest;
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

	validateTargetLineage({
		page,
		issues,
		requireTargetLineage: Boolean(options.requireTargetLineage),
	});

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

function validateTargetLineage(input: {
	page: OfficialWebSourceTruthBundle["pages"][number];
	issues: CollectorValidationIssue[];
	requireTargetLineage: boolean;
}): void {
	if (input.requireTargetLineage && !hasCompleteTargetLineage(input.page)) {
		input.issues.push({
			severity: "error",
			category: "correctness",
			code: "target_lineage_missing",
			message: `page manifest is missing target lineage for ${input.page.rawAssetId}/${input.page.rawVersionId}`,
		});
	}
}

function hasCompleteTargetLineage(page: OfficialWebSourceTruthBundle["pages"][number]): boolean {
	return Boolean(
		page.targetJobId &&
			page.targetDeclarationVersion &&
			Array.isArray(page.targetMatches) &&
			page.targetMatches.length > 0 &&
			page.materializationPolicy &&
			typeof page.selectedWriteTarget === "string" &&
			page.reviewPolicy,
	);
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
		rows.some((row) => row.rawAssetId !== page.rawAssetId || row.rawVersionId !== page.rawVersionId)
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
		extraction = JSON.parse(
			readFileSync(providerPath, "utf-8"),
		) as OfficialWebProviderPageExtraction;
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
