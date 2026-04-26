import {
	curriculumSameLevelHeadingFamily,
	inferCurriculumStructuralLabelLevel,
	looksLikeCurriculumCourseRequirementSentence,
	looksLikeCurriculumFigureOrTableCaption,
	looksLikeCurriculumLeadIn,
	looksLikeCurriculumNoiseLabel,
	looksLikeCurriculumNumberedHeading,
	looksLikeCurriculumVersionNote,
	normalizeCurriculumHeadingLevel,
	normalizeCurriculumHeadingText,
	renderCurriculumLeadIn,
	renderCurriculumTableCaption,
	shouldRenderCurriculumCaptionAsHeading,
} from "./curriculum-markdown-patterns";
import type { MarkdownBlock } from "./curriculum-types";

const MARKDOWN_HEADING_BLOCK_RE = /^(#{1,6})\s+(.+)$/;

export function appendCurriculumHeading(
	blocks: MarkdownBlock[],
	text: string,
	sourceLevel: unknown,
	lastHeadingLevel: number | undefined,
): number | undefined {
	let headingText = normalizeCurriculumHeadingText(text);
	if (!headingText) {
		return lastHeadingLevel;
	}
	const splitHeading = splitCurriculumNumberedHeadingWithInlineListIntro(headingText);
	if (splitHeading) {
		headingText = splitHeading[0];
		const level = appendCurriculumStructuralHeadingBlock(
			blocks,
			headingText,
			sourceLevel,
			lastHeadingLevel,
		);
		blocks.push(["block", splitHeading[1]]);
		return level;
	}
	if (headingText.endsWith("如下")) {
		blocks.push(["block", renderCurriculumLeadIn(headingText)]);
		return lastHeadingLevel;
	}
	if (
		looksLikeCurriculumVersionNote(headingText) ||
		looksLikeCurriculumCourseRequirementSentence(headingText)
	) {
		blocks.push(["paragraph", headingText]);
		return lastHeadingLevel;
	}
	return appendCurriculumStructuralHeadingBlock(blocks, headingText, sourceLevel, lastHeadingLevel);
}

export function appendCurriculumStructuralHeadingBlock(
	blocks: MarkdownBlock[],
	headingText: string,
	sourceLevel: unknown,
	lastHeadingLevel: number | undefined,
): number {
	let level = normalizeCurriculumHeadingLevel(sourceLevel, lastHeadingLevel);
	const headingFamily = curriculumSameLevelHeadingFamily(headingText);
	if (headingFamily) {
		const previousFamilyHeading = findLastCurriculumHeadingFamilyBlock(blocks, headingFamily);
		if (previousFamilyHeading) {
			level = previousFamilyHeading[0];
		} else if (lastHeadingLevel !== undefined && level <= lastHeadingLevel) {
			level = Math.min(lastHeadingLevel + 1, 6);
		}
	}
	blocks.push(["block", `${"#".repeat(level)} ${headingText}`]);
	return level;
}

function splitCurriculumNumberedHeadingWithInlineListIntro(
	text: string,
): [string, string] | undefined {
	const match =
		/^(?<heading>(?:[（(]?\d+[)）.、]|[0-9]+[.．])\s*.+?)\s*[。.;；]\s*(?<intro>课程清单如下)$/.exec(
			text.trim(),
		);
	if (!match?.groups) {
		return;
	}
	const headingText = normalizeCurriculumHeadingText(match.groups.heading);
	if (!(headingText && looksLikeCurriculumNumberedHeading(headingText))) {
		return;
	}
	return [headingText, match.groups.intro];
}

function findLastCurriculumHeadingFamilyBlock(
	blocks: MarkdownBlock[],
	family: string,
): [number, string] | undefined {
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const match = MARKDOWN_HEADING_BLOCK_RE.exec(blocks[index]?.[1] ?? "");
		if (!match) {
			continue;
		}
		const level = match[1]?.length ?? 0;
		const headingText = match[2]?.trim() ?? "";
		if (curriculumSameLevelHeadingFamily(headingText) === family) {
			return [level, headingText];
		}
		if (level <= 2) {
			break;
		}
	}
	return;
}

export function appendCurriculumCaptionBlock(
	blocks: MarkdownBlock[],
	text: string,
	lastHeadingLevel: number | undefined,
): number | undefined {
	if (!text || looksLikeCurriculumNoiseLabel(text)) {
		return lastHeadingLevel;
	}
	if (looksLikeCurriculumFigureOrTableCaption(text)) {
		blocks.push(["block", renderCurriculumTableCaption(text)]);
		return lastHeadingLevel;
	}
	if (looksLikeCurriculumLeadIn(text)) {
		blocks.push(["block", renderCurriculumLeadIn(text)]);
		return lastHeadingLevel;
	}
	if (shouldRenderCurriculumCaptionAsHeading(text)) {
		let level = inferCurriculumStructuralLabelLevel(text, lastHeadingLevel);
		const headingText = normalizeCurriculumHeadingText(text);
		if (headingText) {
			const headingFamily = curriculumSameLevelHeadingFamily(headingText);
			const previousFamilyHeading = headingFamily
				? findLastCurriculumHeadingFamilyBlock(blocks, headingFamily)
				: undefined;
			if (previousFamilyHeading) {
				level = previousFamilyHeading[0];
			} else if (headingFamily && lastHeadingLevel !== undefined && level <= lastHeadingLevel) {
				level = Math.min(lastHeadingLevel + 1, 6);
			}
			blocks.push(["block", `${"#".repeat(level)} ${headingText}`]);
			return level;
		}
		return lastHeadingLevel;
	}
	blocks.push(["block", text]);
	return lastHeadingLevel;
}
