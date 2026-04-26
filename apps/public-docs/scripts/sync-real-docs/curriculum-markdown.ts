import { buildCourseMapSectionBlock } from "./course-map";
import {
	appendCurriculumCaptionBlock,
	appendCurriculumHeading,
	appendCurriculumStructuralHeadingBlock,
} from "./curriculum-markdown-blocks";
import {
	isCurriculumCourseMapHeading,
	isCurriculumCourseMapSectionBoundaryRow,
	iterRows,
	looksLikeCurriculumFigureOrTableCaption,
	looksLikeCurriculumLeadIn,
	looksLikeCurriculumSpecialtyGraduationLabel,
	normalizeCurriculumBodyText,
	normalizeCurriculumHeadingText,
	renderCurriculumLeadIn,
	renderCurriculumTableCaption,
	renderMarkdownBlockLines,
	shouldMergeParagraph,
	splitCurriculumInlineArabicEnums,
	splitCurriculumTrailingLeadIn,
} from "./curriculum-markdown-patterns";
import {
	coalesceCurriculumTableContinuations,
	repairKnownCurriculumDocsTableHtml,
	repairKnownCurriculumDocsTextArtifacts,
} from "./curriculum-table-repair";
import type { MarkdownBlock } from "./curriculum-types";
import { convertTableHtmlToMarkdownBlocks } from "./html-table";
import {
	buildDocumentMetaPanelBlock,
	buildDocumentReaderMetadataFromJsonl,
	buildReaderFrontmatterLines,
	type CourseMapDocEmbed,
	jsonString,
	normalizeText,
	wrapMarkdownPlainText,
} from "./shared";

export function buildCurriculumMarkdown(input: {
	title: string;
	jsonlText: string;
	slug?: string;
	courseMapEmbed?: CourseMapDocEmbed;
	objectKey?: string;
}): string {
	const lines = [
		"---",
		`title: ${jsonString(input.title)}`,
		"footer: false",
		...buildReaderFrontmatterLines({
			kind: "curriculumPlan",
			layout: "tabular",
			measure: "wide",
		}),
		"---",
		"",
	];
	if (input.courseMapEmbed) {
		lines.push(
			`import CourseMapSection from "${input.courseMapEmbed.componentImportPath}";`,
			`import ${input.courseMapEmbed.dataImportName} from "${input.courseMapEmbed.dataImportPath}";`,
			"",
		);
	}
	lines.push(
		buildDocumentMetaPanelBlock(
			buildDocumentReaderMetadataFromJsonl({
				collectionLabel: "培养方案",
				jsonlText: input.jsonlText,
				objectKey: input.objectKey,
			}),
			{ mdx: true },
		),
		"",
	);

	const blocks: MarkdownBlock[] = [];
	let inCourseMapSection = false;
	let insertedCourseMapSection = false;
	let pendingCourseMapHeadingText: string | undefined;
	let lastHeadingLevel: number | undefined;

	for (const row of coalesceCurriculumTableContinuations([...iterRows(input.jsonlText)])) {
		const rowType = String(row.row_type ?? "");
		const text =
			rowType === "heading" || rowType === "paragraph" || rowType === "table_caption"
				? repairKnownCurriculumDocsTextArtifacts(
						input.title,
						normalizeCurriculumBodyText(row.clean_text),
					)
				: normalizeText(row.clean_text);
		if (rowType === "page_number") {
			continue;
		}
		if (inCourseMapSection) {
			if (rowType === "heading" && isCurriculumCourseMapSectionBoundaryRow(text, row)) {
				inCourseMapSection = false;
				pendingCourseMapHeadingText = undefined;
			} else {
				if (!input.courseMapEmbed && rowType === "table") {
					if (pendingCourseMapHeadingText) {
						blocks.push(["block", `## ${pendingCourseMapHeadingText}`]);
						pendingCourseMapHeadingText = undefined;
					}
					const html = repairKnownCurriculumDocsTableHtml(
						input.title,
						normalizeText(row.html) || text,
					);
					if (html) {
						for (const [blockType, blockText] of convertTableHtmlToMarkdownBlocks(html)) {
							if (blockType === "section_label") {
								lastHeadingLevel = appendCurriculumCaptionBlock(
									blocks,
									blockText,
									lastHeadingLevel,
								);
								continue;
							}
							blocks.push(["block", blockText]);
						}
					}
				}
				continue;
			}
		}
		if (rowType === "heading") {
			if (isCurriculumCourseMapHeading(text)) {
				const sectionHint = normalizeText(row.section_hint);
				if (input.courseMapEmbed) {
					blocks.push(["block", "## 课程地图"]);
					blocks.push(["block", buildCourseMapSectionBlock(input.courseMapEmbed)]);
					insertedCourseMapSection = true;
				} else {
					pendingCourseMapHeadingText = normalizeCurriculumHeadingText(text);
				}
				inCourseMapSection =
					input.courseMapEmbed !== undefined ||
					sectionHint === "section" ||
					sectionHint === "chapter";
				lastHeadingLevel = 2;
				continue;
			}
			if (text === input.title && blocks.length === 0) {
				continue;
			}
			lastHeadingLevel = appendCurriculumHeading(blocks, text, row.heading_level, lastHeadingLevel);
			continue;
		}
		if (rowType === "table_caption" && text) {
			lastHeadingLevel = appendCurriculumCaptionBlock(
				blocks,
				wrapMarkdownPlainText(text),
				lastHeadingLevel,
			);
			continue;
		}
		if (rowType === "table") {
			const html = repairKnownCurriculumDocsTableHtml(input.title, normalizeText(row.html) || text);
			if (html) {
				for (const [blockType, blockText] of convertTableHtmlToMarkdownBlocks(html)) {
					if (blockType === "section_label") {
						lastHeadingLevel = appendCurriculumCaptionBlock(blocks, blockText, lastHeadingLevel);
						continue;
					}
					blocks.push(["block", blockText]);
				}
			}
			continue;
		}
		if (rowType !== "paragraph" || !text) {
			continue;
		}
		const trailingLeadInSplit = splitCurriculumTrailingLeadIn(text);
		if (trailingLeadInSplit) {
			blocks.push(["paragraph", trailingLeadInSplit[0]]);
			blocks.push(["block", renderCurriculumLeadIn(trailingLeadInSplit[1])]);
			continue;
		}
		if (looksLikeCurriculumFigureOrTableCaption(text)) {
			blocks.push(["block", renderCurriculumTableCaption(text)]);
			continue;
		}
		if (looksLikeCurriculumSpecialtyGraduationLabel(text)) {
			lastHeadingLevel = appendCurriculumStructuralHeadingBlock(
				blocks,
				normalizeCurriculumHeadingText(text),
				3,
				lastHeadingLevel,
			);
			continue;
		}
		if (looksLikeCurriculumLeadIn(text)) {
			blocks.push(["block", renderCurriculumLeadIn(text)]);
			continue;
		}
		const enumSegments = splitCurriculumInlineArabicEnums(text);
		if (enumSegments.length > 1) {
			for (const segment of enumSegments) {
				blocks.push(["paragraph", segment]);
			}
			continue;
		}
		if (
			blocks.length > 0 &&
			blocks.at(-1)?.[0] === "paragraph" &&
			shouldMergeParagraph(blocks.at(-1)?.[1] ?? "", text)
		) {
			const previous = blocks.pop();
			if (previous) {
				blocks.push(["paragraph", previous[1] + text]);
			}
		} else {
			blocks.push(["paragraph", text]);
		}
	}

	for (const [, blockText] of blocks) {
		lines.push(...renderMarkdownBlockLines(blockText), "");
	}
	if (input.courseMapEmbed && !insertedCourseMapSection) {
		throw new Error(`missing 课程地图 section while published blocks exist for ${input.title}`);
	}
	return `${lines.join("\n").trimEnd()}\n`;
}
