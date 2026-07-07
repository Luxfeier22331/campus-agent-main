import type { CheerioCrawlingContext } from "crawlee";
import type {
	OfficialWebContentBlockRow,
	OfficialWebHostPolicy,
	OfficialWebPageSignalSummary,
} from "./core/index.ts";
import {
	containsDateLikeText,
	isContactLikeText,
	isShortDirectoryLinkText,
	looksLikeDateText,
} from "./page-artifacts-helpers.ts";
import type { ExtractedBlockCandidate, PageFamilyClassification } from "./page-artifacts-types.ts";

export function countRepeatedCandidateTexts(
	candidates: readonly Pick<
		ExtractedBlockCandidate,
		"blockRole" | "textNormalized" | "isMainContent"
	>[],
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

export function isRepeatedCandidate(
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

export function summarizePageSignals(input: {
	contentBlocks: OfficialWebContentBlockRow[];
	html: CheerioCrawlingContext["$"];
	responseBody: string;
	looksLikeDynamicShell: (responseBody: string) => boolean;
	looksLikeStructuralShell: (html: CheerioCrawlingContext["$"]) => boolean;
}): OfficialWebPageSignalSummary {
	const mainBlocks = input.contentBlocks.filter((item) => item.isMainContent);
	const allTables = input.contentBlocks.filter((item) => item.blockRole === "table");
	const mainTables = mainBlocks.filter((item) => item.blockRole === "table");
	const listingTableCount = allTables.filter(
		(item) => classifyTableBlock(item) === "listing",
	).length;
	const galleryTableCount = allTables.filter(
		(item) => classifyTableBlock(item) === "gallery",
	).length;
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
		contactLikeMainBlockCount: mainBlocks.filter((item) => isContactLikeText(item.textNormalized))
			.length,
		dateLikeMainBlockCount: mainBlocks.filter((item) => containsDateLikeText(item.textNormalized))
			.length,
		repeatedNonMainBlockCount: input.contentBlocks.filter((item) => item.isRepeatedCandidate)
			.length,
		mainContentCharacterCount,
		zeroMainContent: mainBlocks.length === 0,
		structuralShellSignal: mainBlocks.length === 0 && input.looksLikeStructuralShell(input.html),
		dynamicShellSignal: mainBlocks.length === 0 && input.looksLikeDynamicShell(input.responseBody),
	};
}

export function classifyPageFamily(input: {
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
		/(通讯录|机构|部门|办公室|院领导|领导|联系方式|联系我们|学院介绍|学院简介|概况|教师|师资)/.test(
			titleHint,
		);
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
	const paragraphHeavyArticleSignal =
		input.pageSignals.mainTableCount === 0 &&
		input.pageSignals.mainHeadingCount >= 1 &&
		input.pageSignals.mainParagraphCount >= 6 &&
		input.pageSignals.mainContentCharacterCount >= 240 &&
		input.pageSignals.mainParagraphCount >= Math.max(6, input.pageSignals.mainLinkCount * 2);

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

	if (paragraphHeavyArticleSignal) {
		return {
			pageFamily: "article_detail",
			confidence: 0.9,
			reason: "paragraph_dominant_main_content",
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
			reason:
				input.pageSignals.galleryTableCount > 0
					? "gallery_table_signal"
					: "gallery_keyword_and_main_links",
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
				confidence: directoryHint || input.pageSignals.contactLikeMainBlockCount >= 2 ? 0.9 : 0.78,
				reason:
					directoryHint || input.pageSignals.contactLikeMainBlockCount >= 2
						? "directory_table_signal"
						: "directory_site_table_signal",
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
		input.pageSignals.mainParagraphCount <= 2 &&
		input.pageSignals.mainContentCharacterCount <= 240
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
		input.pageSignals.mainLinkCount <=
			Math.max(4, input.pageSignals.mainParagraphCount + input.pageSignals.mainListItemCount)
	) {
		return {
			pageFamily: "article_detail",
			confidence: 0.9,
			reason: "paragraph_dominant_main_content",
		};
	}

	if (
		input.hostPolicy.publicKind === "directory_site" &&
		(directoryHint ||
			input.pageSignals.mainLinkCount >= 4 ||
			input.pageSignals.contactLikeMainBlockCount >= 1)
	) {
		return {
			pageFamily: "directory_page",
			confidence: directoryHint ? 0.8 : 0.72,
			reason: directoryHint ? "directory_site_keyword_signal" : "directory_site_structure_signal",
		};
	}

	if (input.pageSignals.mainLinkCount >= 3 && input.pageSignals.mainParagraphCount <= 2) {
		return {
			pageFamily: "listing_page",
			confidence: 0.74,
			reason: "dense_main_link_listing_signal",
		};
	}

	return {
		pageFamily: "generic_content_page",
		confidence: 0.65,
		reason: "generic_content_signal",
	};
}

export function classifyTableBlock(
	block: Pick<OfficialWebContentBlockRow, "tableHtml" | "tableCells">,
): "listing" | "gallery" | "data" | null {
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
