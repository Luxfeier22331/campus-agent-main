import { unicodeLength } from "../encoding.ts";
import type { ChunkPart, SourceRange } from "../types.ts";

// 《…》大纲类行是目录合集（如选课手册）中每份大纲的边界锚点；识别它让
// headingPath 在大纲切换处重置，避免上一份大纲的章节标题漂移到后续 chunk。
// 关键词必须在《》外：裸书名号行（如《…评聘工作方案》）与通知标题不可区分，不识别。
export const OUTLINE_ANCHOR_HEADING =
	/^《[^》]{2,60}》(?:教学大纲|课程大纲|培养方案|实施办法|实施细则|竞赛章程)$/u;

export const PRIMARY_HEADING =
	/^(?:[一二三四五六七八九十百]+\s*[、.．]|第[一二三四五六七八九十百0-9]+(?:章|节|部分))\s*\S.*$/u;

export const SECONDARY_HEADING = /^[（(][一二三四五六七八九十百]+[）)]\s*\S.*$/u;

export const SENTENCE_END = /[。！？!?]/u;

export const CLAUSE_END = /[；;，,、：:]/u;

export interface SourceLine extends SourceRange {
	index: number;
	text: string;
}

export interface SemanticUnit {
	atomic: boolean;
	bodyLines: SourceLine[];
	compositionKey: string;
	hardSectionId: number;
	headingPath: string[];
	joinSeparator?: "\n" | "\n\n";
	kind: SemanticUnitKind;
	unitId: number;
	protectedTailLineCount: number;
	retrievalHeadingPath?: string[];
}

export interface TextBlock {
	range: SourceRange;
}

export interface UnitPiece extends ChunkPart {
	atomic: boolean;
	compositionKey: string;
	hardSectionId: number;
	kind: SemanticUnitKind;
	unitId: number;
	joinSeparator: "\n" | "\n\n";
	wholeUnit: boolean;
}

export interface BodySegment {
	/** Leading headingPath entries owned by the enclosing asset section. */
	assetContextLength: number;
	bodyLines: SourceLine[];
	hardSectionId: number;
	headingPath: string[];
	groupContext?: string;
}

export interface TableRegion {
	endIndex: number;
	headerStartIndex: number;
	firstRowIndex: number;
	compositionKey: string;
	rows: TableRow[];
	retrievalHeadingPath: string[];
}

export interface TableRow {
	endIndex: number;
	startIndex: number;
}

export type SplitReason = "clause" | "hard" | "sentence";

export type SemanticUnitKind =
	| "field"
	| "footer"
	| "list-item"
	| "record"
	| "table-header"
	| "table-row"
	| "text";

export const PURE_ORDINAL = /^\d{1,4}$/u;

export const tableHeaderTerms = [
	"序号",
	"姓名",
	"学号",
	"学院",
	"专业",
	"组别",
	"奖项",
	"时间",
	"刊名",
	"出版社",
	"作者",
	"单位",
	"排名",
	"类别",
	"是否",
	"项目名称",
] as const;

export function isRecordStart(value: string): boolean {
	return /^(?:\d+\s*[.、）)]\s*)?姓名\s*[:：](?:\s*\S.*)?$/u.test(value.trim());
}

export function recordIdentity(value: string): string | null {
	const match = value.trim().match(/(?:姓名\s*[:：]\s*)([^，,；;。]+)/u);
	return match?.[1]?.trim() || null;
}

export function reportTitle(value: string): string | null {
	return (
		value.trim().match(/^(?:\d+\s*[.．、，,）)]\s*)?报告题目\s*[:：]\s*(\S.*)$/u)?.[1] ?? null
	);
}

export function isReportStart(lines: readonly SourceLine[], index: number): boolean {
	if (!reportTitle(lines[index]?.text ?? "")) return false;
	let speaker = false;
	let time = false;
	for (const line of lines.slice(index + 1)) {
		const text = line.text.trim();
		if (
			reportTitle(text) || isRecordStart(text) ||
			PRIMARY_HEADING.test(text) || SECONDARY_HEADING.test(text)
		) break;
		speaker ||= /^报告人\s*[:：]\s*\S/u.test(text);
		time ||= /^报告时间\s*[:：]\s*\S/u.test(text);
		if (speaker && time) return true;
	}
	return false;
}

/** A group-wide introduction may own several following formal subheadings. */
export function isGroupScopeStart(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text.trim() ?? "";
	if (
		!/^[^。！？!?；;：:]{1,80}各组别(?:具体)?(?:参赛|申报)?(?:条件|要求)如下[：:]/u.test(text)
	) return false;
	const next = lines.slice(index + 1).find(line => line.text.trim());
	return Boolean(next && SECONDARY_HEADING.test(next.text.trim()));
}

export function isLabelOnly(value: string): boolean {
	const text = value.trim();
	return (
		text.length > 1 &&
		text.length <= 100 &&
		(/[：:]$/u.test(text) || /^【[^】]{1,80}】$/u.test(text)) &&
		!isSalutationLine(text) &&
		!isNarrativeLead(text) &&
		!isUrlLine(text)
	);
}

export function isNarrativeLead(value: string): boolean {
	return /如下[：:]$/u.test(value.trim());
}

export function isInlineLabelLead(value: string): boolean {
	const text = value.trim();
	if (!text || text.length > 180 || isUrlLine(text)) return false;
	if (/^(?:上午|下午|晚上|中午)?\s*\d{1,2}[:：]\d{2}/u.test(text)) return false;
	if (/^【[^】]{1,80}】\s*\S/u.test(text)) return true;
	const match = text.match(/^(.{1,80}?)[：:]\s*\S/u);
	if (!match || /[。！？!?；;]/u.test(match[1] ?? "")) return false;
	const label = match[1]?.trim() ?? "";
	if (!label || isNarrativeLabel(label)) return false;
	return !/[。！？!?；;：:]$/u.test(text);
}

export function isNarrativeLabel(value: string): boolean {
	return /^(?:根据|现将|现就|为|为了|本次|此次|结合|按照|经|针对|关于|以下|具体|相关).{0,45}$/u.test(
		value.trim(),
	);
}

export function isFieldGroupStart(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text ?? "";
	return !isListItemStart(text) && isFieldLabelStart(lines, index);
}

export function isFieldLabelStart(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text ?? "";
	return isLabelOnly(text) || isInlineLabelLead(text) || isLocalLabel(lines, index);
}

export function isUrlLine(value: string): boolean {
	return /^(?:https?:\/\/|mailto:)\S+$/u.test(value.trim());
}

export function hasBlankLineBetween(previous: SourceLine | undefined, current: SourceLine | undefined): boolean {
	return Boolean(previous && current && current.index > previous.index + 1);
}

export function isLocalLabel(lines: readonly SourceLine[], index: number): boolean {
	const text = lines[index]?.text.trim() ?? "";
	if (!LOCAL_LABEL.test(text)) {
		return false;
	}
	const next = lines[index + 1];
	if (!next) return false;
	return (
		isListItemStart(next.text) ||
		(unicodeLength(text) <= 60 &&
			!isRecordStart(next.text) &&
			!isTopicLead(next.text) &&
			!isSignatureLine(next.text))
	);
}

export function isListItemStart(value: string): boolean {
	return listMarkerLevel(value) !== null;
}

export function isTopLevelListItemStart(value: string): boolean {
	return listMarkerLevel(value) === 1;
}

export function listMarkerLevel(value: string): 1 | 2 | null {
	const text = value.trim();
	if (/^\d{1,3}\s*[.．、）)](?:\s*\S.*)?$/u.test(text)) return 1;
	if (
		/^[（(](?:\d{1,3}|[一二三四五六七八九十百]+)[）)]\s*\S/u.test(text) ||
		/^[①②③④⑤⑥⑦⑧⑨⑩]\s*\S/u.test(text)
	) {
		return 2;
	}
	return null;
}

export function isIndependentBracketListStart(
	lines: readonly SourceLine[],
	index: number,
): boolean {
	if (listMarkerLevel(lines[index]?.text ?? "") !== 2) return false;
	if (index > 0 && !isDirectListLead(lines[index - 1]?.text ?? "")) return false;
	for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
		const text = lines[cursor]?.text ?? "";
		const markerLevel = listMarkerLevel(text);
		if (markerLevel === 2) return true;
		if (
			markerLevel === 1 ||
			isRecordStart(text) ||
			isTopicLead(text) ||
			isSignatureLine(text) ||
			isClosingStart(lines, cursor) ||
			isFooterLine(lines, cursor)
		) {
			return false;
		}
	}
	return false;
}

export function isDirectListLead(value: string): boolean {
	const text = value.trim();
	if (!text) return true;
	if (listMarkerLevel(text) !== null) return false;
	return !/(?:以下|包括|满足|之一)[：:]?$/u.test(text);
}

export function isImageCaptionLine(value: string): boolean {
	const text = value.trim();
	if (!text || unicodeLength(text) > 100 || isUrlLine(text)) return false;
	return (
		/^[（(【[]?[^。！？!?；;\n]{0,60}(?:二维码|小程序码)[）)】\]]?[：:]?$/u.test(text) ||
		/^(?:请|可)?(?:扫描|扫码)[^。！？!?；;\n]{0,80}[：:]?[。.]?$/u.test(text)
	);
}

export function isFooterLine(lines: readonly SourceLine[], index: number): boolean {
	if (!isEditorialCreditLine(lines[index]?.text ?? "")) return false;
	return lines.slice(index + 1).every((line) => {
		const text = line.text.trim();
		return (
			isEditorialCreditLine(text) ||
			isSignatureLine(text) ||
			isOrganizationLine(text) ||
			isDateLine(text)
		);
	});
}

export function isEditorialCreditLine(value: string): boolean {
	return /^(?:撰稿|供稿|供图|作者|审核)[：:]\s*\S/u.test(value.trim());
}

export function isTopicLead(value: string): boolean {
	const text = value.trim();
	return (
		/^聚焦/u.test(text) ||
		/^开放/u.test(text) ||
		/^本奖项面向/u.test(text) ||
		/^以[“"「].{1,40}[”"」]为核心/u.test(text) ||
		/^系统展示/u.test(text) ||
		/^围绕[^，。]{1,40}(?:开展|进行|设置)/u.test(text)
	);
}

export function isSalutationLine(value: string): boolean {
	return /^(?:各|尊敬的|亲爱的|致|广大师生|全体(?:师生|教职工|学生))[^。！？!?；;]{0,100}[：:]$/u.test(
		value.trim(),
	);
}

export function isSignatureLine(value: string): boolean {
	return /^\s*[—–―]{1,3}\s*\S/u.test(value);
}

export function isClosingStart(lines: readonly SourceLine[], index: number): boolean {
	if (index < Math.max(0, lines.length - 3)) return false;
	const text = lines[index]?.text.trim() ?? "";
	if (isDateLine(text)) return true;
	const next = lines[index + 1]?.text.trim() ?? "";
	return Boolean(isOrganizationLine(text) && isDateLine(next));
}

export function isDateLine(value: string): boolean {
	return /^(?:\d{4}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2})?|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)$/u.test(
		value.trim(),
	);
}

export function isOrganizationLine(value: string): boolean {
	const text = value.trim();
	return (
		text.length > 0 &&
		text.length <= 30 &&
		/(?:学院|大学|处|部|室|中心|委员会|研究院|研究生院|办公室|团委|党委|实验室|学校|协会|系)$/u.test(
			text,
		)
	);
}

export function isTableTerminator(value: string): boolean {
	const text = value.trim();
	return /^(?:公示时间|受理意见|联系方式|联系人|联系电话|如有异议|主要完成人|主要完成单位|注|备注|科研处|教务处|国际合作处|理学院|中央民族大学)/u.test(
		text,
	);
}

export function contextLabel(value: string): string {
	const text = value.trim().replace(/[：:。]$/u, "");
	return text.length <= 80 ? text : `${text.slice(0, 77)}…`;
}

export function withContext(basePath: readonly string[], contexts: readonly string[]): string[] {
	return [...basePath, ...contexts.filter((value) => value.length > 0)];
}

export function contextKey(basePath: readonly string[], contexts: readonly string[]): string {
	return JSON.stringify([...basePath, ...contexts]);
}

export function sectionCompositionKey(headingPath: readonly string[]): string {
	return contextKey(headingPath, []);
}

export const LOCAL_LABEL = /^[（(](?:[一二三四五六七八九十百]+|\d{1,2})[）)]\s*[^。！？!?；;]{1,80}。?$/u;

export function unicodeLetterOrNumber(value: string): boolean {
	return /^[\p{L}\p{N}]$/u.test(value);
}

export function unicodeNumber(value: string): boolean {
	return /^\p{N}$/u.test(value);
}

/** Local parents remain source text, rather than becoming formal headingPath entries. */
export function localScope(lines: readonly SourceLine[], index: number): { end: number } | null {
	const text = lines[index]?.text.trim() ?? "";
	const next = lines[index + 1]?.text.trim() ?? "";
	let sibling: RegExp;
	if (/^No\.\s*\d+\s+\S/iu.test(text)) sibling = /^No\.\s*\d+\s+\S/iu;
	else if (/^第[一二三四五六七八九十]+批(?:[、，]第[一二三四五六七八九十]+批)*[：:]$/u.test(text))
		sibling = /^第[一二三四五六七八九十]+批/u;
	else if (
		/^(?:\d{4}年)?\d{1,2}月\d{1,2}日(?:[（(][^）)]*[）)])?(?:分两场进行)?$/u.test(text) &&
		/(?:\d{1,2}[:：]\d{2}|时间[：:])/u.test(next)
	)
		sibling = /^(?:\d{4}年)?\d{1,2}月\d{1,2}日/u;
	else if (
		/^[（(][一二三四五六七八九十]+[）)].*[：:]$/u.test(text) &&
		isTopLevelListItemStart(next)
	)
		sibling = /^[（(][一二三四五六七八九十]+[）)]/u;
	else if (
		/(?:满足|符合|具备).*(?:以下|下列).*(?:条件|要求).*?[：:]$/u.test(text) &&
		isTopLevelListItemStart(next)
	)
		sibling = /^[（(][一二三四五六七八九十]+[）)]/u;
	else return null;
	let end = index + 1;
	while (
		end < lines.length &&
		!sibling.test(lines[end]!.text.trim()) &&
		!isClosingStart(lines, end)
	)
		end++;
	return end > index + 1 ? { end } : null;
}
