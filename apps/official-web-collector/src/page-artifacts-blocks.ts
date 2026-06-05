import type { CheerioCrawlingContext } from "crawlee";
import {
	buildOfficialWebContentBlockRow,
	buildOfficialWebRawAssetId,
	buildOfficialWebRawVersionId,
	hashOfficialWebContent,
	type OfficialWebContentBlockRow,
} from "./official-web-core.ts";
import { extractBlockCandidates } from "./page-artifacts-extraction.ts";
import { countRepeatedCandidateTexts, isRepeatedCandidate } from "./page-artifacts-page-family.ts";

export function buildCollectedContentBlocks(input: {
	html: CheerioCrawlingContext["$"];
	baseUrl: string;
	normalizedCanonicalUrl: string;
	responseBodyHash: string;
	siteDisplayName: string;
	siteId: string;
}): {
	contentBlocks: OfficialWebContentBlockRow[];
	mainContentHash: string;
	rawAssetId: string;
	rawVersionId: string;
} {
	const extractedBlocks = extractBlockCandidates({
		html: input.html,
		baseUrl: input.baseUrl,
		siteDisplayName: input.siteDisplayName,
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
