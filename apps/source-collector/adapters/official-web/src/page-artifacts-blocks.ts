import type { CheerioCrawlingContext } from "crawlee";
import {
	buildOfficialWebContentBlockRow,
	buildOfficialWebRawAssetId,
	buildOfficialWebRawVersionId,
	hashOfficialWebContent,
	type OfficialWebContentBlockRow,
} from "./core/index.ts";
import { extractBlockCandidates } from "./page-artifacts-extraction.ts";
import { countRepeatedCandidateTexts, isRepeatedCandidate } from "./page-artifacts-page-family.ts";
import { extractReaderBlockCandidates } from "./page-artifacts-reader.ts";
import type { ExtractedBlockCandidate } from "./page-artifacts-types.ts";

const THIN_MAIN_CONTENT_CHARACTER_THRESHOLD = 240;
const THIN_MAIN_PARAGRAPH_THRESHOLD = 6;

export function buildCollectedContentBlocks(input: {
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	normalizedCanonicalUrl: string;
	responseBody: string;
	responseBodyHash: string;
	siteDisplayName: string;
	siteId: string;
}): {
	contentBlocks: OfficialWebContentBlockRow[];
	mainContentHash: string;
	rawAssetId: string;
	rawVersionId: string;
} {
	const primaryBlocks = extractBlockCandidates({
		html: input.html,
		baseUrl: input.baseUrl,
		siteDisplayName: input.siteDisplayName,
	});
	const extractedBlocks = withReaderFallbackCandidates({
		primaryBlocks,
		baseUrl: input.baseUrl,
		responseBody: input.responseBody,
	});
	const normalizedMainContent = extractedBlocks
		.filter(
			(item) => item.isMainContent && item.textNormalized != null && item.textNormalized.length > 0,
		)
		.map((item) => item.textNormalized);
	const mainContentHash = hashOfficialWebContent(normalizedMainContent.join("\n"));
	const rawAssetId = buildOfficialWebRawAssetId({
		siteId: input.siteId,
		normalizedCanonicalUrl: input.normalizedCanonicalUrl,
	});
	const rawVersionId = buildOfficialWebRawVersionId({
		normalizedCanonicalUrl: input.normalizedCanonicalUrl,
		responseBodyHash: input.responseBodyHash,
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

	return {
		contentBlocks,
		mainContentHash,
		rawAssetId,
		rawVersionId,
	};
}

function withReaderFallbackCandidates(input: {
	primaryBlocks: ExtractedBlockCandidate[];
	baseUrl: string;
	responseBody: string;
}): ExtractedBlockCandidate[] {
	if (
		!shouldAppendReaderFallback({
			blocks: input.primaryBlocks,
			baseUrl: input.baseUrl,
		})
	) {
		return input.primaryBlocks;
	}

	const readerBlocks = extractReaderBlockCandidates({
		responseBody: input.responseBody,
		baseUrl: input.baseUrl,
	});
	const primaryTexts = new Set(
		input.primaryBlocks
			.map((item) => item.textNormalized)
			.filter((item): item is string => item != null && item.length > 0),
	);
	const appendedReaderBlocks = readerBlocks.filter(
		(item) => item.textNormalized != null && !primaryTexts.has(item.textNormalized),
	);
	if (appendedReaderBlocks.length === 0) {
		return input.primaryBlocks;
	}

	return [...input.primaryBlocks, ...appendedReaderBlocks];
}

function shouldAppendReaderFallback(input: {
	blocks: readonly ExtractedBlockCandidate[];
	baseUrl: string;
}): boolean {
	if (!isDetailPageReaderFallbackUrl(input.baseUrl)) {
		return false;
	}
	const mainBlocks = input.blocks.filter((item) => item.isMainContent);
	const mainCharacterCount = mainBlocks.reduce(
		(total, item) => total + (item.textNormalized?.length ?? 0),
		0,
	);
	const mainParagraphCount = mainBlocks.filter((item) => item.blockRole === "paragraph").length;
	return (
		mainCharacterCount < THIN_MAIN_CONTENT_CHARACTER_THRESHOLD ||
		mainParagraphCount < THIN_MAIN_PARAGRAPH_THRESHOLD
	);
}

function isDetailPageReaderFallbackUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return /\/info\/\d+\/\d+\.html?$/i.test(url.pathname);
	} catch {
		return false;
	}
}
