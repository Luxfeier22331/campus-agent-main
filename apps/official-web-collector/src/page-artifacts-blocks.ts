import type { CheerioCrawlingContext } from "crawlee";
import {
	buildOfficialWebContentBlockRow,
	buildOfficialWebRawAssetId,
	buildOfficialWebRawVersionId,
	hashOfficialWebContent,
	type OfficialWebContentBlockRow,
} from "./official-web-core.ts";
import {
	extractBlockCandidates,
	extractRecoveryBlockCandidates,
} from "./page-artifacts-extraction.ts";
import { countRepeatedCandidateTexts, isRepeatedCandidate } from "./page-artifacts-page-family.ts";
import type { ExtractedBlockCandidate } from "./page-artifacts-types.ts";

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
	const initialExtractedBlocks = extractBlockCandidates({
		html: input.html,
		baseUrl: input.baseUrl,
		siteDisplayName: input.siteDisplayName,
	});
	const recoveredBlocks = needsVisibleContentRecovery(initialExtractedBlocks)
		? extractRecoveryBlockCandidates({
				html: input.html,
				baseUrl: input.baseUrl,
				siteDisplayName: input.siteDisplayName,
			})
		: [];
	const extractedBlocks = mergeExtractedBlockCandidates(initialExtractedBlocks, recoveredBlocks);
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

function needsVisibleContentRecovery(blocks: ExtractedBlockCandidate[]): boolean {
	const mainBlocks = blocks.filter((item) => item.isMainContent);
	if (mainBlocks.length === 0) {
		return true;
	}

	const mainTextLength = mainBlocks.reduce(
		(total, item) => total + (item.textNormalized?.length ?? 0),
		0,
	);
	const bodyLikeMainBlockCount = mainBlocks.filter((item) =>
		["paragraph", "list_item", "table"].includes(item.blockRole),
	).length;
	return mainTextLength <= 120 && bodyLikeMainBlockCount <= 1;
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
	candidate: Pick<
		ExtractedBlockCandidate,
		"blockRole" | "domPath" | "textNormalized" | "linkTarget"
	>,
): string {
	return [
		candidate.blockRole,
		candidate.domPath ?? "",
		candidate.textNormalized ?? "",
		candidate.linkTarget ?? "",
	].join("::");
}
