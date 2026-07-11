import { shortHash } from "./hash.ts";
import type { OfficialWebNextContentBlock, OfficialWebNextSourceTruthBundle } from "./types.ts";

export interface OfficialWebNextDocumentUnit {
	schemaVersion: "official_web_next_document_unit.v1";
	documentUnitId: string;
	rawAssetId: string;
	rawVersionId: string;
	sourceUrl: string;
	title: string;
	text: string;
	sourceBlocks: number[];
}

export interface OfficialWebNextChunk {
	schemaVersion: "official_web_next_chunk.v1";
	chunkId: string;
	documentUnitId: string;
	sourceUrl: string;
	text: string;
	sourceBlockRange: {
		start: number;
		end: number;
	};
}

export interface OfficialWebNextReleaseManifest {
	schemaVersion: "official_web_next_release_manifest.v1";
	releaseId: string;
	siteId: string;
	crawlRunId: string;
	documentUnitCount: number;
	chunkCount: number;
	aliasPublished: false;
	currentPointerUpdated: false;
}

export interface OfficialWebNextReferencePipelineResult {
	documentUnits: OfficialWebNextDocumentUnit[];
	chunks: OfficialWebNextChunk[];
	releaseManifest: OfficialWebNextReleaseManifest;
}

export function buildOfficialWebNextReferencePipeline(input: {
	blocksByObjectKey: Map<string, OfficialWebNextContentBlock[]>;
	bundle: OfficialWebNextSourceTruthBundle;
	releaseId: string;
}): OfficialWebNextReferencePipelineResult {
	const documentUnits = input.bundle.pages.map((page) => {
		const blocks = input.blocksByObjectKey.get(page.contentBlocksObjectKey) ?? [];
		const mainTextBlocks = blocks.filter((block) => block.isMainContent && block.textNormalized);
		const title =
			mainTextBlocks.find((block) => block.blockRole === "title")?.textNormalized ??
			mainTextBlocks.find((block) => block.blockRole === "heading")?.textNormalized ??
			page.normalizedCanonicalUrl;
		return {
			schemaVersion: "official_web_next_document_unit.v1" as const,
			documentUnitId: `owdoc_${page.rawAssetId}_${page.rawVersionId}`,
			rawAssetId: page.rawAssetId,
			rawVersionId: page.rawVersionId,
			sourceUrl: page.normalizedCanonicalUrl,
			title,
			text: mainTextBlocks.map((block) => block.textNormalized).join("\n"),
			sourceBlocks: mainTextBlocks.map((block) => block.rowIndex),
		};
	});
	const chunks = documentUnits.flatMap((unit) => buildChunks(unit));
	return {
		documentUnits,
		chunks,
		releaseManifest: {
			schemaVersion: "official_web_next_release_manifest.v1",
			releaseId: input.releaseId,
			siteId: input.bundle.siteId,
			crawlRunId: input.bundle.crawlRunId,
			documentUnitCount: documentUnits.length,
			chunkCount: chunks.length,
			aliasPublished: false,
			currentPointerUpdated: false,
		},
	};
}

function buildChunks(unit: OfficialWebNextDocumentUnit): OfficialWebNextChunk[] {
	if (!unit.text.trim()) {
		return [];
	}
	return [
		{
			schemaVersion: "official_web_next_chunk.v1",
			chunkId: `owchunk_${shortHash(`${unit.documentUnitId}:${unit.text}`)}`,
			documentUnitId: unit.documentUnitId,
			sourceUrl: unit.sourceUrl,
			text: unit.text,
			sourceBlockRange: {
				start: unit.sourceBlocks[0] ?? 0,
				end: unit.sourceBlocks.at(-1) ?? 0,
			},
		},
	];
}
