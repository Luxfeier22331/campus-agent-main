import type { CurriculumRow } from "./curriculum-types";
import {
	escapeHtmlText,
	MARKDOWN_DECIMAL_LABEL_RE,
	MARKDOWN_LIST_PREFIX_WITH_BREAK_RE,
	MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE,
	MARKDOWN_ORDERED_LIST_RE,
	MARKDOWN_UNORDERED_LIST_RE,
	normalizeText,
	wrapMarkdownTextLines,
} from "./shared";

const CURRICULUM_METADATA_LINE_RE = /^(?:学制|学分|总学分|学位授予|授予学位)[:：].{1,120}$/;

const CURRICULUM_SPECIALTY_GRADUATION_LABEL_RE =
	/^[\p{L}\p{N}（）()、\-·]{2,48}专业毕业要求[:：]$/u;

const CURRICULUM_LEAD_IN_RE =
	/^(?:课程清单如下|建议课程清单|建议课程清单如下|.{1,140}(?:课程清单如下|建议课程清单|建议课程清单如下|清单如下))[:：]?$/;

const CURRICULUM_WEAK_SUBSECTION_LABEL_RE =
	/^(?:[（(]\d{1,2}[)）]\s*)?(?:学年论文要求|综合实践要求|毕业设计要求|论文质量方面|[\p{L}\p{N}（）()、\-·]{2,48}专业拓展培养|毕业五年后应达到的具体目标为|培养目标(?:具体)?细化如下)[:：。]?$/u;

const CURRICULUM_TRAILING_LEAD_IN_RE =
	/^(?<body>.+?[。.;；])\s*(?<intro>(?:课程清单如下|建议课程清单|建议课程清单如下)[:：]?)$/;

const CURRICULUM_INLINE_ARABIC_ENUM_MARKER_RE = /(?:[（(]\d{1,2}[)）]|\d{1,2}[)）])/g;

export function isCurriculumCourseMapHeading(text: string): boolean {
	return normalizeCurriculumHeadingText(text).includes("课程地图");
}

export function normalizeCurriculumHeadingText(text: string): string {
	return text
		.trim()
		.replace(/[：:。]+$/g, "")
		.trim();
}

export function normalizeCurriculumHeadingLevel(
	sourceLevel: unknown,
	lastHeadingLevel: number | undefined,
): number {
	const rawLevel = Math.max(2, Math.min(6, parseCurriculumHeadingLevel(sourceLevel, 2)));
	if (lastHeadingLevel === undefined) {
		return 2;
	}
	return Math.max(2, Math.min(rawLevel, lastHeadingLevel + 1));
}

function parseCurriculumHeadingLevel(value: unknown, defaultValue: number): number {
	const parsed = Number.parseInt(String(value ?? defaultValue), 10);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function inferCurriculumStructuralLabelLevel(
	text: string,
	lastHeadingLevel: number | undefined,
): number {
	if (lastHeadingLevel === undefined) {
		return 3;
	}
	if (looksLikeCurriculumNestedModuleLabel(text)) {
		return lastHeadingLevel < 5 ? Math.min(lastHeadingLevel + 1, 6) : 6;
	}
	return lastHeadingLevel < 4 ? Math.min(lastHeadingLevel + 1, 6) : 5;
}

export function looksLikeCurriculumFigureOrTableCaption(text: string): boolean {
	return /^(表|图|附表|附图)\s*[0-9一二三四五六七八九十]/.test(text.trim());
}

export function looksLikeCurriculumSpecialtyGraduationLabel(text: string): boolean {
	return CURRICULUM_SPECIALTY_GRADUATION_LABEL_RE.test(text.trim());
}

export function looksLikeCurriculumLeadIn(text: string): boolean {
	const normalized = text.trim();
	return Boolean(
		normalized &&
			(CURRICULUM_LEAD_IN_RE.test(normalized) ||
				CURRICULUM_WEAK_SUBSECTION_LABEL_RE.test(normalized)),
	);
}

export function splitCurriculumTrailingLeadIn(text: string): [string, string] | undefined {
	const match = CURRICULUM_TRAILING_LEAD_IN_RE.exec(text.trim());
	const body = match?.groups?.body?.trim();
	const intro = match?.groups?.intro?.trim();
	if (!(body && intro)) {
		return;
	}
	return [body, intro];
}

export function splitCurriculumInlineArabicEnums(text: string): string[] {
	const normalized = text.trim();
	if (!normalized) {
		return [];
	}
	const matches = [...normalized.matchAll(CURRICULUM_INLINE_ARABIC_ENUM_MARKER_RE)];
	if (matches.length < 2 || matches[0]?.index !== 0) {
		return [normalized];
	}
	const segments: string[] = [];
	for (let index = 0; index < matches.length; index += 1) {
		const start = matches[index]?.index ?? 0;
		const end = matches[index + 1]?.index ?? normalized.length;
		const segment = normalized.slice(start, end).trim();
		if (segment) {
			segments.push(segment);
		}
	}
	return segments.length > 1 ? segments : [normalized];
}

export function renderCurriculumLeadIn(text: string): string {
	return `<p className="docs-lead-in">${escapeHtmlText(text.trim())}</p>`;
}

export function renderCurriculumTableCaption(text: string): string {
	return `<p className="docs-table-caption">${escapeHtmlText(text.trim())}</p>`;
}

export function looksLikeCurriculumNestedModuleLabel(text: string): boolean {
	return /^模块[一二三四五六七八九十0-9]+[：:]/.test(text.trim());
}

export function looksLikeCurriculumParenthesizedArabicHeading(text: string): boolean {
	return /^[（(]\d+[)）]/.test(text.trim());
}

export function looksLikeCurriculumNumberedHeading(text: string): boolean {
	return /^(?:[（(]?\d+[)）.、]|[0-9]+[.．])/.test(text.trim());
}

export function looksLikeCurriculumChineseParenthesizedHeading(text: string): boolean {
	return /^[（(][一二三四五六七八九十]+[)）]/.test(text.trim());
}

export function looksLikeCurriculumCourseRequirementSentence(text: string): boolean {
	return /^[（(]\d+[)）]\s*.+课程.+\d+\s*学分[。.]?$/.test(text.trim());
}

function looksLikeCurriculumPracticeRequirementHeading(text: string): boolean {
	return /^(?:学年论文|综合实践|毕业设计)要求$/.test(text.trim());
}

export function looksLikeCurriculumVersionNote(text: string): boolean {
	return /^[（(]?\d{4}\s*版[)）]?$/.test(text.trim());
}

export function curriculumSameLevelHeadingFamily(text: string): string | undefined {
	if (looksLikeCurriculumPracticeRequirementHeading(text)) {
		return "practice_requirement";
	}
	if (looksLikeCurriculumParenthesizedArabicHeading(text)) {
		return "parenthesized_arabic";
	}
	if (looksLikeCurriculumNumberedHeading(text)) {
		return "numbered";
	}
	if (looksLikeCurriculumChineseParenthesizedHeading(text)) {
		return "chinese_parenthesized";
	}
	if (looksLikeCurriculumNestedModuleLabel(text)) {
		return "module";
	}
	return;
}

export function shouldRenderCurriculumCaptionAsHeading(text: string): boolean {
	const normalized = text.trim();
	if (
		!normalized ||
		looksLikeCurriculumFigureOrTableCaption(normalized) ||
		normalized.endsWith("如下")
	) {
		return false;
	}
	return !/^[0-9一二三四五六七八九十]+[.、]/.test(normalized);
}

export function looksLikeCurriculumNoiseLabel(text: string): boolean {
	const normalized = text.trim();
	return !normalized || /^[（(]?[0-9一二三四五六七八九十]+[)）]?$/.test(normalized);
}

export function normalizeCurriculumBodyText(value: unknown): string {
	let normalized = String(value ?? "").trim();
	if (!normalized) {
		return "";
	}
	normalized = normalized.replaceAll("\\geq", "≥").replaceAll("\\leq", "≤").replace(/\r\n?/g, "\n");
	normalized = normalized.replace(MARKDOWN_LIST_PREFIX_WITH_BREAK_RE, "$1 ");
	normalized = normalized.replace(MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE, "$<marker> $<rest>");
	const lines = normalized
		.split("\n")
		.map((line) => line.trim().replace(/[ \t]+/g, " "))
		.filter(Boolean);
	if (lines.length > 1 && looksLikeCurriculumListLines(lines)) {
		return lines.join("\n");
	}
	normalized = normalized.replace(/\s*\n\s*/g, "").replace(/[ \t]+/g, " ");
	return normalized.trim();
}

function looksLikeCurriculumListLines(lines: string[]): boolean {
	return (
		lines.filter(
			(line) =>
				MARKDOWN_ORDERED_LIST_RE.test(line) ||
				MARKDOWN_DECIMAL_LABEL_RE.test(line) ||
				looksLikeCurriculumChineseParenthesizedHeading(line),
		).length >= 2
	);
}

export function isCurriculumCourseMapSectionBoundaryRow(text: string, row: CurriculumRow): boolean {
	if (String(row.row_type ?? "") !== "heading") {
		return false;
	}
	const sectionHint = normalizeText(row.section_hint);
	if (sectionHint === "section" || sectionHint === "chapter") {
		return true;
	}
	const normalized = text.trim();
	return Boolean(
		normalized &&
			(/^[一二三四五六七八九十]+、/.test(normalized) ||
				/^第[一二三四五六七八九十百千万〇零两0-9]+[章节部分]/.test(normalized)),
	);
}

export function* iterRows(jsonlText: string): Generator<CurriculumRow> {
	for (const line of jsonlText.split(/\r?\n/)) {
		const stripped = line.trim();
		if (stripped) {
			yield JSON.parse(stripped) as CurriculumRow;
		}
	}
}

export function shouldMergeParagraph(previous: string, current: string): boolean {
	if (!previous) {
		return false;
	}
	if (
		MARKDOWN_ORDERED_LIST_RE.test(current) ||
		MARKDOWN_DECIMAL_LABEL_RE.test(current) ||
		MARKDOWN_UNORDERED_LIST_RE.test(current) ||
		looksLikeCurriculumChineseParenthesizedHeading(current)
	) {
		return false;
	}
	if (/[。！？；：.!?;:]$/.test(previous)) {
		return false;
	}
	return !looksLikeCompactMetadataLine(previous);
}

function looksLikeCompactMetadataLine(text: string): boolean {
	const normalized = text.trim();
	return (
		CURRICULUM_METADATA_LINE_RE.test(normalized) ||
		/^[^。；！？!?]{1,24}[：:][^，,。；！？!?]{1,16}$/.test(normalized)
	);
}

export function renderMarkdownBlockLines(blockText: string): string[] {
	if (
		blockText.startsWith("#") ||
		blockText.startsWith("<") ||
		blockText.startsWith("import ") ||
		blockText.startsWith("|")
	) {
		return blockText.split(/\r?\n/);
	}
	if (blockText.includes("\n")) {
		const rawLines = blockText.split(/\r?\n/).map((line) => line.trimEnd());
		const strippedLines = rawLines.map((line) => line.trim()).filter(Boolean);
		if (
			strippedLines.length > 0 &&
			strippedLines.every(
				(line) => MARKDOWN_ORDERED_LIST_RE.test(line) || MARKDOWN_DECIMAL_LABEL_RE.test(line),
			)
		) {
			return strippedLines.flatMap((line, index) =>
				index === 0 ? renderMarkdownBlockLines(line) : ["", ...renderMarkdownBlockLines(line)],
			);
		}
		return rawLines;
	}
	if (MARKDOWN_ORDERED_LIST_RE.test(blockText)) {
		const match = MARKDOWN_ORDERED_LIST_RE.exec(blockText);
		const marker = match?.[0].trim() ?? "";
		const content = blockText.slice(match?.[0].length ?? 0);
		return wrapMarkdownTextLines(content, {
			initialPrefix: `${marker} `,
			subsequentPrefix: " ".repeat(marker.length + 1),
		});
	}
	const decimalLabelMatch = MARKDOWN_DECIMAL_LABEL_RE.exec(blockText);
	if (decimalLabelMatch?.groups) {
		const escapedLabel = decimalLabelMatch.groups.label.replace(".", "\\.");
		return wrapMarkdownTextLines(`${escapedLabel}${decimalLabelMatch.groups.rest}`);
	}
	if (MARKDOWN_UNORDERED_LIST_RE.test(blockText)) {
		const marker = blockText.split(" ", 1)[0] ?? "";
		const content = blockText.slice(marker.length + 1);
		return wrapMarkdownTextLines(content, {
			initialPrefix: `${marker} `,
			subsequentPrefix: " ".repeat(marker.length + 1),
		});
	}
	return wrapMarkdownTextLines(blockText);
}
