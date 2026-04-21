import type { OfficialWebContentBlockRow, OfficialWebPageFamily } from "./official-web-core.ts";

export interface ExtractedBlockCandidate {
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

export interface PageFamilyClassification {
	pageFamily: OfficialWebPageFamily;
	confidence: number;
	reason: string;
}

export interface VisibleContentContainerStats {
	element: unknown;
	textLength: number;
	mediaCount: number;
	listCount: number;
	anchorCount: number;
	dateLikeTextCount: number;
	repeatedCardChildCount: number;
	hasPagination: boolean;
}
