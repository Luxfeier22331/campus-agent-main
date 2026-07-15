import { TextEncoder } from "node:util";

import {
	buildOfficialWebSourceArtifactKey,
	type OfficialWebContentBlockRow,
	type OfficialWebDiscoveredLinkRecord,
	type OfficialWebPageManifest,
	type OfficialWebProviderPageExtraction,
} from "./core/index.ts";

import type { CollectorArtifactFile } from "./page-artifacts-contract.ts";
import { toJsonLines } from "./page-artifacts-helpers.ts";
import { OFFICIAL_WEB_PARSER_SLUG } from "./runtime-metadata.ts";

const encoder = new TextEncoder();

export function buildPageArtifactFiles(input: {
	rawAssetId: string;
	rawVersionId: string;
	responseBody: string;
	pageManifest: OfficialWebPageManifest;
	contentBlocks: OfficialWebContentBlockRow[];
	discoveredLinks: OfficialWebDiscoveredLinkRecord[];
	providerExtraction: OfficialWebProviderPageExtraction;
}): CollectorArtifactFile[] {
	return [
		buildFileArtifact({
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			relativePath: "capture/response.html",
			objectKey: buildOfficialWebSourceArtifactKey({
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				stage: "capture",
				filename: "response.html",
			}),
			contentType: "text/html; charset=utf-8",
			body: input.responseBody,
		}),
		buildFileArtifact({
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			relativePath: `provider/${OFFICIAL_WEB_PARSER_SLUG}/page-extraction.json`,
			objectKey: buildOfficialWebSourceArtifactKey({
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				stage: "provider",
				parserSlug: OFFICIAL_WEB_PARSER_SLUG,
				filename: "page-extraction.json",
			}),
			contentType: "application/json",
			body: JSON.stringify(input.providerExtraction, null, 2),
		}),
		buildFileArtifact({
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			relativePath: `provider/${OFFICIAL_WEB_PARSER_SLUG}/discovered-links.jsonl`,
			objectKey: buildOfficialWebSourceArtifactKey({
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				stage: "provider",
				parserSlug: OFFICIAL_WEB_PARSER_SLUG,
				filename: "discovered-links.jsonl",
			}),
			contentType: "application/x-ndjson",
			body: toJsonLines(input.discoveredLinks),
			recordCount: input.discoveredLinks.length,
		}),
		buildFileArtifact({
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			relativePath: "source-truth/page-manifest.json",
			objectKey: buildOfficialWebSourceArtifactKey({
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				stage: "source-truth",
				filename: "page-manifest.json",
			}),
			contentType: "application/json",
			body: JSON.stringify(input.pageManifest, null, 2),
		}),
		buildFileArtifact({
			rawAssetId: input.rawAssetId,
			rawVersionId: input.rawVersionId,
			relativePath: "source-truth/content-blocks.jsonl",
			objectKey: buildOfficialWebSourceArtifactKey({
				rawAssetId: input.rawAssetId,
				rawVersionId: input.rawVersionId,
				stage: "source-truth",
				filename: "content-blocks.jsonl",
			}),
			contentType: "application/x-ndjson",
			body: toJsonLines(input.contentBlocks),
			recordCount: input.contentBlocks.length,
		}),
	];
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
