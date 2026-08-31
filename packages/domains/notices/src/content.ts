import {
	NOTICE_CONTENT_ALIGNMENTS,
	NOTICE_CONTENT_ALLOWED_TAGS,
	NOTICE_CONTENT_MAX_CELL_SPAN,
} from "campus-contracts/notices";
import { JSDOM } from "jsdom";

const ALLOWED_TAGS = new Set<string>(NOTICE_CONTENT_ALLOWED_TAGS);
const ALIGNMENTS = new Set<string>(NOTICE_CONTENT_ALIGNMENTS);

const BLOCK_TAGS = new Set([
	"BLOCKQUOTE",
	"H3",
	"H4",
	"H5",
	"H6",
	"LI",
	"P",
	"TABLE",
	"TD",
	"TH",
	"TR",
]);

const ALIGNABLE_TAGS = new Set(["BLOCKQUOTE", "H3", "H4", "H5", "H6", "P", "TD", "TH"]);
const INLINE_PRESENTATION_TAGS = new Set([
	"A",
	"B",
	"BLOCKQUOTE",
	"EM",
	"FONT",
	"H3",
	"H4",
	"H5",
	"H6",
	"I",
	"LI",
	"MARK",
	"P",
	"S",
	"SPAN",
	"STRONG",
	"TD",
	"TH",
	"U",
]);
const PRUNABLE_TAGS = new Set([
	"A",
	"B",
	"BLOCKQUOTE",
	"EM",
	"H3",
	"H4",
	"H5",
	"H6",
	"I",
	"LI",
	"MARK",
	"OL",
	"P",
	"S",
	"STRONG",
	"U",
	"UL",
]);
const TEXT_EDGE_TAGS = new Set(["BLOCKQUOTE", "H3", "H4", "H5", "H6", "LI", "P", "TD", "TH"]);
const REPEATED_TITLE_TAGS = new Set(["H3", "H4", "H5", "H6", "P"]);

const ALERT_COLORS = new Set([
	"#7b0c00",
	"#c00000",
	"#e53333",
	"#e54c5e",
	"#ee0000",
	"#ff0000",
	"red",
	"rgb(123,12,0)",
	"rgb(192,0,0)",
	"rgb(229,51,51)",
	"rgb(229,76,94)",
	"rgb(238,0,0)",
	"rgb(255,0,0)",
]);
const HIGHLIGHT_COLORS = new Set(["#ff0", "#ffff00", "rgb(255,255,0)", "yellow"]);
const GENERIC_IMAGE_NAME = /^(?:image|img|图片|微信图片)[\s_()（）-]*[0-9]*$/iu;
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu;
const NON_DESCRIPTIVE_IMAGE_NAME = /^[0-9_()（）.-]+$/u;
const NOTICE_TEXT_REPLACEMENTS = [
	["统计表干3月5日前", "统计表于3月5日前"],
	["Al+信息可视化设计", "AI+信息可视化设计"],
	["气模馆", "气膜馆"],
] as const;
const LOGIN_CONTEXT =
	/登陆(?=[^。！？\n]{0,20}(?:系统|平台|网站|门户|页面|账号|账户|模块|客户端|小程序))/gu;
const SPACE_BEFORE_CJK_PUNCTUATION = /[ \u3000]+([，。；：！？、）》】])/gu;
const DUPLICATE_PUNCTUATION = /:\s*；/gu;

type NoticeContentAlignment = (typeof NOTICE_CONTENT_ALIGNMENTS)[number];

interface SourcePresentation {
	alert: boolean;
	align: NoticeContentAlignment | null;
	bold: boolean;
	highlight: boolean;
	indent: boolean;
	underline: boolean;
}

export interface NoticeImageReference {
	normalizedUrl: string;
	ordinal: number;
	sourceOrdinal: number;
	sourceUrl: string;
}

export type NoticeAssetKind = "attachment" | "image";

export interface NormalizedNoticeContent {
	contentHtml: string | null;
	contentText: string | null;
	images: NoticeImageReference[];
}

export function normalizeNoticeContent(input: {
	html: string | null;
	portalHost: string;
	title: string;
}): NormalizedNoticeContent {
	if (input.html === null || !input.html.trim()) {
		return { contentHtml: null, contentText: null, images: [] };
	}
	const dom = new JSDOM(`<body>${input.html}</body>`);
	const { document, Node } = dom.window;
	const images: NoticeImageReference[] = [];
	normalizeHeadingLevels(document.body, document);
	cleanChildren(document.body, {
		document,
		images,
		portalHost: input.portalHost.toLowerCase(),
		sourceImageOrdinal: 0,
	});
	applyNoticeTextCorrections(document.body);
	trimBlockTextEdges(document.body);
	pruneEmptyElements(document.body);
	removeRepeatedTitle(document.body, input.title);
	pruneEmptyElements(document.body);
	const text = deriveStructuredText(document.body, Node);
	const hasStructuredContent = Boolean(text || document.body.querySelector("IMG, TABLE"));
	const html = hasStructuredContent ? document.body.innerHTML.trim() : "";
	return {
		contentHtml: html || null,
		contentText: text || null,
		images,
	};
}

function applyNoticeTextCorrections(root: Element): void {
	for (const textNode of collectTextNodes(root)) {
		let value = textNode.textContent ?? "";
		for (const [from, to] of NOTICE_TEXT_REPLACEMENTS) {
			value = value.replaceAll(from, to);
		}
		value = value
			.replace(LOGIN_CONTEXT, "登录")
			.replace(SPACE_BEFORE_CJK_PUNCTUATION, "$1")
			.replace(DUPLICATE_PUNCTUATION, "；");
		textNode.textContent = value;
	}
}

function normalizeHeadingLevels(root: Element, document: Document): void {
	const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
	const levels = headings.map((heading) => Number(heading.tagName.slice(1)));
	const minimumLevel = levels.length > 0 ? Math.min(...levels) : 1;
	for (const [index, heading] of headings.entries()) {
		const level = Math.min(6, 3 + (levels[index] as number) - minimumLevel);
		const replacement = document.createElement(`h${level}`);
		for (const attribute of [...heading.attributes]) {
			replacement.setAttribute(attribute.name, attribute.value);
		}
		replacement.append(...heading.childNodes);
		heading.replaceWith(replacement);
	}
}

function cleanChildren(
	parent: Element,
	input: {
		document: Document;
		images: NoticeImageReference[];
		portalHost: string;
		sourceImageOrdinal: number;
	},
): void {
	for (const child of [...parent.childNodes]) {
		if (child.nodeType === child.COMMENT_NODE) {
			child.remove();
			continue;
		}
		if (child.nodeType === child.TEXT_NODE) {
			child.textContent = normalizeInlineWhitespace(child.textContent ?? "");
			continue;
		}
		if (child.nodeType !== child.ELEMENT_NODE) {
			child.remove();
			continue;
		}
		const element = child as Element;
		if (["IFRAME", "FORM", "SCRIPT", "STYLE"].includes(element.tagName)) {
			element.remove();
			continue;
		}

		const presentation = sourcePresentation(element);
		const originalAlt = element.getAttribute("alt");
		const originalColspan = element.getAttribute("colspan");
		const originalHeight = element.getAttribute("height");
		const originalHref = element.getAttribute("href");
		const originalRowspan = element.getAttribute("rowspan");
		const originalSrc = element.getAttribute("src");
		const originalWidth = element.getAttribute("width");
		const isFirstRow =
			element.tagName === "TR" &&
			(element.getAttribute("class") ?? "").split(/\s+/u).includes("firstRow");

		cleanChildren(element, input);
		if (!ALLOWED_TAGS.has(element.tagName)) {
			const replacement = INLINE_PRESENTATION_TAGS.has(element.tagName)
				? wrapNodes(input.document, [...element.childNodes], presentation)
				: [...element.childNodes];
			element.replaceWith(...replacement);
			continue;
		}

		for (const attribute of [...element.attributes]) {
			element.removeAttribute(attribute.name);
		}
		if (element.tagName === "A") {
			const href = safeLink(originalHref);
			if (!href) {
				element.replaceWith(...element.childNodes);
				continue;
			}
			element.setAttribute("href", href);
			element.setAttribute("rel", "noopener noreferrer");
		}
		if (element.tagName === "IMG") {
			const normalized = normalizePortalImageUrl(originalSrc, input.portalHost);
			if (!normalized) {
				element.remove();
				continue;
			}
			const sourceOrdinal = input.sourceImageOrdinal;
			input.sourceImageOrdinal += 1;
			if (isEditorPlaceholderImage(normalized, originalWidth, originalHeight)) {
				element.remove();
				continue;
			}
			const ordinal = input.images.length;
			input.images.push({
				normalizedUrl: normalized,
				ordinal,
				sourceOrdinal,
				sourceUrl: originalSrc ?? "",
			});
			element.setAttribute("src", `notice-asset:image:${ordinal}`);
			element.setAttribute("alt", normalizeImageAlt(originalAlt));
			continue;
		}
		if (element.tagName === "TD" || element.tagName === "TH") {
			setCellSpan(element, "colspan", originalColspan);
			setCellSpan(element, "rowspan", originalRowspan);
		}
		applyBlockPresentation(element, presentation);
		applyInlinePresentation(element, presentation, input.document);
		if (isFirstRow) {
			for (const cell of [...element.children]) {
				if (cell.tagName === "TD") {
					const header = input.document.createElement("th");
					for (const attribute of [...cell.attributes]) {
						header.setAttribute(attribute.name, attribute.value);
					}
					header.setAttribute("scope", "col");
					header.append(...cell.childNodes);
					cell.replaceWith(header);
				} else if (cell.tagName === "TH") {
					cell.setAttribute("scope", "col");
				}
			}
		}
	}
}

function sourcePresentation(element: Element): SourcePresentation {
	const style = (element as HTMLElement).style;
	const color = compactCssValue(style.color || element.getAttribute("color") || "");
	const background = compactCssValue(style.backgroundColor || style.background || "");
	const fontWeight = compactCssValue(style.fontWeight);
	const textDecoration = compactCssValue(style.textDecorationLine || style.textDecoration);
	const explicitAlignment = normalizeAlignment(style.textAlign || element.getAttribute("align"));
	const indent = normalizeIndent(style.textIndent);
	return {
		alert: ALERT_COLORS.has(color),
		align:
			explicitAlignment === "center" || explicitAlignment === "end"
				? explicitAlignment
				: indent === "wide"
					? "end"
					: explicitAlignment,
		bold: fontWeight === "bold" || (Number(fontWeight) >= 600 && Number(fontWeight) <= 1000),
		highlight: HIGHLIGHT_COLORS.has(background),
		indent: indent === "first-line",
		underline: textDecoration.includes("underline"),
	};
}

function applyBlockPresentation(element: Element, presentation: SourcePresentation): void {
	if (ALIGNABLE_TAGS.has(element.tagName) && presentation.align) {
		element.setAttribute("data-align", presentation.align);
	}
	if (
		element.tagName === "P" &&
		presentation.indent &&
		presentation.align !== "center" &&
		presentation.align !== "end"
	) {
		element.setAttribute("data-indent", "true");
	}
}

function applyInlinePresentation(
	element: Element,
	presentation: SourcePresentation,
	document: Document,
): void {
	if (!INLINE_PRESENTATION_TAGS.has(element.tagName)) {
		return;
	}
	const remaining = { ...presentation };
	if (element.tagName === "STRONG") {
		remaining.bold = false;
		if (remaining.alert) {
			element.setAttribute("data-emphasis", "alert");
			remaining.alert = false;
		}
	} else if (element.tagName === "B") {
		remaining.bold = false;
	}
	if (element.tagName === "U") {
		remaining.underline = false;
	}
	if (element.tagName === "MARK") {
		remaining.highlight = false;
	}
	const wrapped = wrapNodes(document, [...element.childNodes], remaining);
	if (
		wrapped.length !== element.childNodes.length ||
		wrapped.some((node, index) => node !== element.childNodes[index])
	) {
		element.replaceChildren(...wrapped);
	}
}

function wrapNodes(document: Document, nodes: Node[], presentation: SourcePresentation): Node[] {
	let wrapped = nodes;
	if (presentation.bold || presentation.alert) {
		const strong = document.createElement("strong");
		if (presentation.alert) {
			strong.setAttribute("data-emphasis", "alert");
		}
		strong.append(...wrapped);
		wrapped = [strong];
	}
	if (presentation.underline) {
		const underline = document.createElement("u");
		underline.append(...wrapped);
		wrapped = [underline];
	}
	if (presentation.highlight) {
		const mark = document.createElement("mark");
		mark.append(...wrapped);
		wrapped = [mark];
	}
	return wrapped;
}

function normalizeAlignment(value: string | null): NoticeContentAlignment | null {
	const normalized = compactCssValue(value ?? "").replace(/!important$/u, "");
	const mapped =
		normalized === "right" ? "end" : normalized === "-webkit-center" ? "center" : normalized;
	return ALIGNMENTS.has(mapped) ? (mapped as NoticeContentAlignment) : null;
}

function normalizeIndent(value: string): "first-line" | "none" | "wide" {
	const normalized = value.trim();
	const match = /^([+]?(?:\d+(?:\.\d+)?|\.\d+))(em|px|rem)?$/iu.exec(normalized);
	if (!match) {
		return "none";
	}
	const amount = Number(match[1]);
	if (amount <= 0) {
		return "none";
	}
	const unit = match[2]?.toLowerCase();
	if ((unit === "px" && amount >= 135) || ((unit === "em" || unit === "rem") && amount >= 6)) {
		return "wide";
	}
	return "first-line";
}

function setCellSpan(element: Element, name: "colspan" | "rowspan", value: string | null): void {
	if (!(value && /^[0-9]+$/u.test(value))) {
		return;
	}
	const span = Number(value);
	if (span >= 2 && span <= NOTICE_CONTENT_MAX_CELL_SPAN) {
		element.setAttribute(name, String(span));
	}
}

function safeLink(value: string | null): string | null {
	const normalized = value?.trim();
	if (!normalized) {
		return null;
	}
	try {
		const parsed = new URL(normalized);
		return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? normalized : null;
	} catch {
		return null;
	}
}

function normalizePortalImageUrl(value: string | null, portalHost: string): string | null {
	if (!value) {
		return null;
	}
	try {
		const parsed = new URL(value, `https://${portalHost}`);
		if (
			parsed.hostname.toLowerCase() !== portalHost ||
			!["http:", "https:"].includes(parsed.protocol)
		) {
			return null;
		}
		parsed.protocol = "https:";
		parsed.username = "";
		parsed.password = "";
		return parsed.toString();
	} catch {
		return null;
	}
}

function isEditorPlaceholderImage(
	normalizedUrl: string,
	widthValue: string | null,
	heightValue: string | null,
): boolean {
	if (new URL(normalizedUrl).pathname.toLowerCase().endsWith("/spacer.gif")) {
		return true;
	}
	const width = parsePositiveDimension(widthValue);
	const height = parsePositiveDimension(heightValue);
	return width !== null && height !== null && width <= 1 && height <= 1;
}

function parsePositiveDimension(value: string | null): number | null {
	if (!(value && /^\d+(?:\.\d+)?$/u.test(value.trim()))) {
		return null;
	}
	const dimension = Number(value);
	return dimension > 0 ? dimension : null;
}

function normalizeImageAlt(value: string | null): string {
	const normalized = normalizeInlineWhitespace(value ?? "").trim();
	if (!normalized) {
		return "";
	}
	const stem = normalized.replace(IMAGE_EXTENSION, "");
	if (GENERIC_IMAGE_NAME.test(stem) || NON_DESCRIPTIVE_IMAGE_NAME.test(stem)) {
		return "";
	}
	return normalized.slice(0, 500);
}

function trimBlockTextEdges(root: Element): void {
	for (const element of [root, ...root.querySelectorAll("*")]) {
		if (element !== root && !TEXT_EDGE_TAGS.has(element.tagName)) {
			continue;
		}
		const textNodes = collectTextNodes(element);
		const first = textNodes[0];
		const last = textNodes.at(-1);
		if (first) {
			first.textContent = first.textContent?.replace(/^\s+/u, "") ?? "";
		}
		if (last) {
			last.textContent = last.textContent?.replace(/\s+$/u, "") ?? "";
		}
	}
}

function collectTextNodes(root: Element): Text[] {
	const nodes: Text[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === node.TEXT_NODE) {
			nodes.push(node as Text);
			return;
		}
		for (const child of [...node.childNodes]) {
			visit(child);
		}
	};
	visit(root);
	return nodes;
}

function pruneEmptyElements(parent: Element): void {
	for (const element of [...parent.children]) {
		pruneEmptyElements(element);
		if (
			PRUNABLE_TAGS.has(element.tagName) &&
			!normalizeComparableText(element.textContent ?? "") &&
			!element.querySelector("IMG, TABLE")
		) {
			element.remove();
		}
	}
}

function removeRepeatedTitle(root: Element, title: string): void {
	const firstMeaningfulNode = [...root.childNodes].find(
		(node) =>
			node.nodeType !== node.TEXT_NODE || Boolean(normalizeComparableText(node.textContent ?? "")),
	);
	if (!firstMeaningfulNode || firstMeaningfulNode.nodeType !== firstMeaningfulNode.ELEMENT_NODE) {
		return;
	}
	const firstElement = firstMeaningfulNode as Element;
	if (
		!REPEATED_TITLE_TAGS.has(firstElement.tagName) ||
		firstElement.querySelector("A, IMG, OL, TABLE, UL")
	) {
		return;
	}
	const normalizedTitle = normalizeComparableText(title);
	const firstBreak = firstElement.querySelector("BR");
	if (firstBreak) {
		const range = firstElement.ownerDocument.createRange();
		range.selectNodeContents(firstElement);
		range.setEndBefore(firstBreak);
		if (normalizeComparableText(range.cloneContents().textContent ?? "") === normalizedTitle) {
			range.deleteContents();
			firstBreak.remove();
		}
		return;
	}
	if (normalizeComparableText(firstElement.textContent ?? "") === normalizedTitle) {
		firstElement.remove();
	}
}

function normalizeInlineWhitespace(value: string): string {
	return value.replace(/[\t\n\r\f\v \u00a0\u3000]+/gu, " ");
}

function normalizeComparableText(value: string): string {
	return value.replace(/[\s\u200b]+/gu, " ").trim();
}

function compactCssValue(value: string): string {
	return value.toLowerCase().replace(/\s+/gu, "").trim();
}

interface LogicalNoticeTableCell {
	columnSpan: number;
	id: number;
	originRow: number;
	rowSpan: number;
	text: string;
}

interface NoticeTableValue {
	columns: number[];
	text: string;
}

function deriveStructuredText(root: Element, NodeCtor: typeof Node): string {
	const parts: string[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === NodeCtor.TEXT_NODE) {
			parts.push(node.textContent ?? "");
			return;
		}
		if (node.nodeType !== NodeCtor.ELEMENT_NODE) {
			return;
		}
		const element = node as Element;
		if (element.tagName === "TABLE") {
			const tableText = serializeLogicalNoticeTable(element, NodeCtor);
			if (tableText) {
				parts.push(tableText);
			}
			parts.push("\n");
			return;
		}
		if (element.tagName === "BR") {
			parts.push("\n");
		}
		for (const child of [...element.childNodes]) {
			visit(child);
		}
		if (BLOCK_TAGS.has(element.tagName)) {
			parts.push("\n");
		}
	};
	visit(root);
	return parts
		.join("")
		.replace(/[\t\f\v \u00a0]+/gu, " ")
		.replace(/ *\n */gu, "\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

function serializeLogicalNoticeTable(table: Element, NodeCtor: typeof Node): string {
	const rows = tableRows(table);
	if (rows.length === 0) {
		return "";
	}
	const physicalRows = rows.map((row) =>
		tableCells(row).map((cell) => ({
			cell,
			text: normalizeNoticeTableCellText(deriveStructuredText(cell, NodeCtor)),
		})),
	);
	const grid = buildNoticeTableGrid(physicalRows);
	if (!grid) {
		return serializePhysicalNoticeRows(physicalRows);
	}
	const headerCount = explicitTableHeaderCount(rows, table);
	if (headerCount === 0) {
		return serializePositionedNoticeRows(grid);
	}
	const columnPaths = noticeTableColumnPaths(grid, headerCount);
	return grid
		.slice(headerCount)
		.map((row) => serializeNoticeTableRow(row, columnPaths))
		.filter(Boolean)
		.join("\n");
}

function normalizeNoticeTableCellText(value: string): string {
	return value.replace(/[\t\n\r\f\v\u00a0\u3000 ]+/gu, " ").trim();
}

function serializePhysicalNoticeRows(
	rows: readonly (readonly { cell: Element; text: string }[])[],
): string {
	return rows
		.map((row) =>
			row
				.map((cell) => cell.text)
				.filter(Boolean)
				.join("；"),
		)
		.filter(Boolean)
		.join("\n");
}

function explicitTableHeaderCount(rows: readonly Element[], table: Element): number {
	const headerRows = new Set([...table.querySelectorAll("THEAD > TR, THEAD > TBODY > TR")]);
	let count = 0;
	while (count < rows.length && headerRows.has(rows[count] as Element)) {
		count += 1;
	}
	return count;
}

function serializePositionedNoticeRows(
	grid: readonly (readonly (LogicalNoticeTableCell | undefined)[])[],
): string {
	let section: string | null = null;
	const lines: string[] = [];
	for (const [rowIndex, row] of grid.entries()) {
		const sectionCell = noticeTableSectionCell(row, rowIndex, grid[0]?.length ?? 0);
		if (sectionCell) {
			section = sectionCell.text;
			continue;
		}
		const values = uniqueNoticeTableCells(row)
			.map((cell) => cell.text)
			.filter(Boolean);
		if (values.length === 0) {
			continue;
		}
		lines.push([section, ...values].filter(Boolean).join("；"));
	}
	return lines.join("\n");
}

function tableRows(table: Element): Element[] {
	const rows: Element[] = [];
	for (const child of [...table.children]) {
		if (child.tagName === "TR") {
			rows.push(child);
			continue;
		}
		if (!["THEAD", "TBODY", "TFOOT"].includes(child.tagName)) {
			continue;
		}
		for (const row of [...child.children]) {
			if (row.tagName === "TR") {
				rows.push(row);
			}
		}
	}
	return rows;
}

function tableCells(row: Element): Element[] {
	return [...row.children].filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
}

function buildNoticeTableGrid(
	rows: readonly (readonly { cell: Element; text: string }[])[],
): Array<Array<LogicalNoticeTableCell | undefined>> | null {
	const grid: Array<Array<LogicalNoticeTableCell | undefined>> = [];
	let cellId = 0;
	for (const [rowIndex, row] of rows.entries()) {
		grid[rowIndex] ??= [];
		let columnIndex = 0;
		for (const item of row) {
			while (grid[rowIndex]?.[columnIndex] !== undefined) {
				columnIndex += 1;
			}
			const rowSpan = noticeCellSpan(item.cell.getAttribute("rowspan"));
			const columnSpan = noticeCellSpan(item.cell.getAttribute("colspan"));
			const logicalCell: LogicalNoticeTableCell = {
				columnSpan,
				id: cellId,
				originRow: rowIndex,
				rowSpan,
				text: item.text,
			};
			cellId += 1;
			for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
				const targetRow = rowIndex + rowOffset;
				grid[targetRow] ??= [];
				for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
					const targetColumn = columnIndex + columnOffset;
					if (grid[targetRow]?.[targetColumn] !== undefined) {
						return null;
					}
					(grid[targetRow] as Array<LogicalNoticeTableCell | undefined>)[targetColumn] =
						logicalCell;
				}
			}
			columnIndex += columnSpan;
		}
	}
	const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
	return grid.map((row) => Array.from({ length: width }, (_, index) => row[index]));
}

function noticeCellSpan(value: string | null): number {
	if (!(value && /^[0-9]+$/u.test(value))) {
		return 1;
	}
	const span = Number(value);
	return span >= 1 && span <= NOTICE_CONTENT_MAX_CELL_SPAN ? span : 1;
}

function noticeTableSectionCell(
	row: readonly (LogicalNoticeTableCell | undefined)[],
	rowIndex: number,
	width: number,
): LogicalNoticeTableCell | null {
	const cells = uniqueNoticeTableCells(row);
	const cell = cells[0];
	return cell &&
		width > 1 &&
		cells.length === 1 &&
		cell.originRow === rowIndex &&
		cell.columnSpan >= width &&
		cell.text
		? cell
		: null;
}

function uniqueNoticeTableCells(
	row: readonly (LogicalNoticeTableCell | undefined)[],
): LogicalNoticeTableCell[] {
	const cells: LogicalNoticeTableCell[] = [];
	const seen = new Set<number>();
	for (const cell of row) {
		if (!cell || seen.has(cell.id)) {
			continue;
		}
		seen.add(cell.id);
		cells.push(cell);
	}
	return cells;
}

function noticeTableColumnPaths(
	rows: readonly (readonly (LogicalNoticeTableCell | undefined)[])[],
	headerCount: number,
): string[][] {
	const width = rows[0]?.length ?? 0;
	return Array.from({ length: width }, (_, columnIndex) => [
		...new Set(
			rows
				.slice(0, headerCount)
				.map((row) => row[columnIndex]?.text ?? "")
				.filter(Boolean),
		),
	]);
}

function serializeNoticeTableRow(
	row: readonly (LogicalNoticeTableCell | undefined)[],
	columnPaths: readonly (readonly string[])[],
): string {
	const values: NoticeTableValue[] = [];
	const emitted = new Set<number>();
	for (const cell of row) {
		if (!cell || emitted.has(cell.id)) {
			continue;
		}
		emitted.add(cell.id);
		if (!cell.text) {
			continue;
		}
		const columns = row.flatMap((candidate, index) => (candidate?.id === cell.id ? [index] : []));
		const label = compactNoticeTableLabel(columns, columnPaths);
		values.push({ columns, text: label ? `${label}：${cell.text}` : cell.text });
	}
	return values.map((value) => value.text).join("；");
}

function compactNoticeTableLabel(
	columns: readonly number[],
	columnPaths: readonly (readonly string[])[],
): string {
	const paths = [
		...new Map(
			columns
				.map((column) => columnPaths[column] ?? [])
				.filter((path) => path.length > 0)
				.map((path) => [path.join("\u0000"), path] as const),
		).values(),
	];
	if (paths.length === 0) {
		return "";
	}
	if (paths.length === 1) {
		return paths[0]?.join(" / ") ?? "";
	}
	return paths.map((path) => path.join(" / ")).join("、");
}
