import { readFileSync } from "node:fs";
import {
	convertTableHtmlToMarkdownBlocks,
	sanitizePreservedHtmlForMdx,
	shouldPreserveTableAsHtml,
} from "./html-table";
import {
	asArray,
	asRecord,
	buildDocumentMetaPanelBlock,
	buildDocumentReaderMetadataFromFrontmatter,
	buildReaderFrontmatterLines,
	escapeHtmlText,
	HANDBOOK_ARTICLE_HEADING_RE,
	HANDBOOK_CHAPTER_HEADING_RE,
	HANDBOOK_COLLECTION,
	HANDBOOK_CORPUS,
	HANDBOOK_DOC_SLUG_OVERRIDES,
	HANDBOOK_FILENAME,
	HANDBOOK_NOISE_LINES,
	HANDBOOK_REVISION_TRACK,
	HANDBOOK_SPLIT_MANIFEST_PATH,
	HANDBOOK_YEAR,
	type HandbookDoc,
	MARKDOWN_DECIMAL_LABEL_RE,
	MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE,
	MARKDOWN_ORDERED_LIST_RE,
	MARKDOWN_UNORDERED_LIST_RE,
	sha1Hex,
	wrapMarkdownTextLines,
} from "./shared";

const INLINE_PERCENT_MATH_RE = /\$\s*(?<value>\d+(?:\.\d+)?)\s*\\?%\s*\$/g;
const INLINE_RIGHT_ARROW_MATH_RE = /\$\s*\\rightarrow\s*\$/g;
const HANDBOOK_NUMBERED_CLAUSE_HEADING_RE = /^[一二三四五六七八九十]+、/;
const HANDBOOK_LEAD_IN_RE =
	/^(?:附[:：]|.{2,120}(?:如下|以下|包括|范围|职责是|负责|程序|计划项目主要包括|方式的资助)[:：])$/;
const HANDBOOK_INLINE_ENUM_MARKER_RE = /[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]/g;
const HANDBOOK_INLINE_NUMBERED_HEADING_MARKER_RE =
	/[一二三四五六七八九十百千万〇零两]+、[\p{Script=Han}、与及和-]{2,16}/gu;
const HANDBOOK_INLINE_NUMBERED_HEADING_RE =
	/^[一二三四五六七八九十百千万〇零两]+、[\p{Script=Han}、与及和-]{2,12}$/u;
const HANDBOOK_INLINE_HEADING_BODY_STARTERS = [
	"中央民族大学",
	"党委学生工作部",
	"本科学生",
	"各院系",
	"学院",
	"学校",
	"学生",
	"教务处",
	"院系",
	"指导教师",
];
const HANDBOOK_INLINE_HEADING_SUFFIXES = [
	"管理",
	"项目",
	"职责",
	"程序",
	"计划",
	"要求",
	"办法",
	"说明",
	"标准",
	"条件",
	"实施",
];

export function buildHandbookIndex(): string {
	return [
		"---",
		"title: 学生手册",
		"description: 中央民族大学学生手册公开阅读目录。",
		"footer: false",
		...buildReaderFrontmatterLines({
			kind: "collectionLanding",
			layout: "landing",
			measure: "standard",
			outlinePolicy: "none",
		}),
		"outline: false",
		"---",
		"",
		"这里汇总学生在校学习、生活、资助、纪律、住宿和医疗等常用制度文件。",
		"",
		"你可以从左侧目录按文件进入，也可以使用顶部搜索直接查询“转专业”“奖学金”“违纪处分”“公费医疗”等关键词。",
		"",
	].join("\n");
}

export function loadHandbookDocs(): HandbookDoc[] {
	const manifest = JSON.parse(readFileSync(HANDBOOK_SPLIT_MANIFEST_PATH, "utf-8"));
	const docs: HandbookDoc[] = [];
	const seenSlugs = new Set<string>();
	for (const item of asArray(asRecord(manifest)?.documents)) {
		const record = asRecord(item);
		const documentId = String(record?.document_id ?? "").trim();
		const title = String(record?.title ?? "").trim();
		if (!(documentId && title)) {
			throw new Error(
				`handbook split manifest document requires document_id/title: ${JSON.stringify(item)}`,
			);
		}
		const slug = buildHandbookDocSlug({ documentId, title });
		if (seenSlugs.has(slug)) {
			throw new Error(`duplicate handbook slug discovered: ${slug}`);
		}
		seenSlugs.add(slug);
		docs.push({ documentId, slug, title });
	}
	return docs;
}

export function buildHandbookDocSlug(input: { documentId: string; title: string }): string {
	const override = HANDBOOK_DOC_SLUG_OVERRIDES.get(input.documentId);
	if (override) {
		return override;
	}
	const slug = input.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	return slug || `student-handbook-${sha1Hex(input.documentId).slice(0, 10)}`;
}

export function buildHandbookDocKey(doc: HandbookDoc): string {
	const documentSuffix = documentIdSuffix(doc.documentId);
	const titleSlug = slugifyPathLabel(doc.title || documentSuffix);
	const docid8 = documentIdShortLabel(doc.documentId, documentSuffix);
	return [
		HANDBOOK_CORPUS,
		"documents",
		HANDBOOK_COLLECTION,
		`${titleSlug}--${docid8}`,
		HANDBOOK_REVISION_TRACK,
		HANDBOOK_YEAR,
		HANDBOOK_FILENAME,
	].join("/");
}

export function cleanHandbookMarkdown(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	if (lines.length === 0) {
		return markdown;
	}
	let frontmatterEnd = -1;
	if (lines[0]?.trim() === "---") {
		for (let index = 1; index < lines.length; index += 1) {
			if (lines[index]?.trim() === "---") {
				frontmatterEnd = index;
				break;
			}
		}
	}
	let prefix = frontmatterEnd === -1 ? [] : lines.slice(0, frontmatterEnd + 1);
	const body = frontmatterEnd === -1 ? lines : lines.slice(frontmatterEnd + 1);
	if (prefix.length > 0) {
		prefix = normalizeHandbookFrontmatter(prefix);
	}
	const title = frontmatterTitle(prefix);
	const repairedBody = repairKnownHandbookDocsMarkdown(body.join("\n"), title).split(/\r?\n/);
	const cleanedBody: string[] = [];
	let previousBlank = false;
	for (const line of repairedBody) {
		const stripped = line.trim();
		if (HANDBOOK_NOISE_LINES.has(stripped)) {
			continue;
		}
		if (!stripped) {
			if (!previousBlank) {
				cleanedBody.push("");
			}
			previousBlank = true;
			continue;
		}
		previousBlank = false;
		cleanedBody.push(line.trimEnd());
	}
	const metadataBlock =
		prefix.length > 0
			? [
					buildDocumentMetaPanelBlock(
						buildDocumentReaderMetadataFromFrontmatter({
							collectionLabel: "学生手册",
							frontmatterLines: prefix,
							versionYear: HANDBOOK_YEAR,
						}),
					),
					"",
				]
			: [];
	return `${[...prefix, ...metadataBlock, ...normalizeHandbookBody(cleanedBody, title)]
		.join("\n")
		.trimEnd()}\n`;
}

export function convertHandbookTableHtmlToMarkdownBlocks(html: string): [string, string][] {
	return convertTableHtmlToMarkdownBlocks(html);
}

function documentIdSuffix(documentId: string): string {
	const segments = documentId
		.split(":")
		.map((part) => part.trim())
		.filter(Boolean);
	const suffix = segments.at(-1);
	if (!suffix) {
		throw new Error("document_id is required");
	}
	return suffix;
}

function documentIdShortLabel(documentId: string, documentSuffix: string): string {
	const normalizedSuffix = slugifyPathLabel(documentSuffix);
	if (looksLikeHash(normalizedSuffix) && normalizedSuffix.length > 8) {
		return normalizedSuffix.slice(0, 8);
	}
	const normalized = slugifyPathLabel(documentId);
	if (looksLikeHash(normalized) && normalized.length > 8) {
		return normalized.slice(0, 8);
	}
	return normalizedSuffix;
}

function looksLikeHash(value: string): boolean {
	return value.length >= 8 && /^[0-9a-f]+$/.test(value);
}

function slugifyPathLabel(value: string): string {
	let slug = value
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	while (slug.includes("--")) {
		slug = slug.replaceAll("--", "-");
	}
	return slug || "document";
}

function repairKnownHandbookDocsMarkdown(markdown: string, title: string | undefined): string {
	let repaired = markdown;
	if (title === "中央民族大学本科学分制实施办法") {
		repaired = repaired.replace(
			'<tr><td colspan="2">教育学</td><td>体育类</td><td>145学分</td><td></td></tr>',
			'<tr><td colspan="2">教育学</td><td>145学分</td><td></td><td></td></tr><tr><td colspan="2">体育类</td><td>145学分</td><td></td><td></td></tr>',
		);
	}
	if (
		title === "中央民族大学本(预)科学生勤工助学管理办法" ||
		title === "中央民族大学本-预-科学生勤工助学管理办法"
	) {
		repaired = repaired.replace(
			/家庭经济困难学生的勤工助学岗位聘用率,原则上应不低于 \$70\\%\$[。．…]*/g,
			"家庭经济困难学生的勤工助学岗位聘用率,原则上应不低于 70%。",
		);
	}
	if (title === "中央民族大学学生志愿服务管理办法") {
		repaired = repaired
			.replace(
				"## 一、为进一步规范中央民族大学学生志愿服务管理工作,特制定本办法",
				"一、为进一步规范中央民族大学学生志愿服务管理工作,特制定本办法",
			)
			.replace("## 5.其他相关工作情况", "5.其他相关工作情况")
			.replace("## (二)参评集体为注册志愿服务组织", "(二)参评集体为注册志愿服务组织")
			.replace(
				"## 一、本办法由共青团中央民族大学委员会负责解释",
				"一、本办法由共青团中央民族大学委员会负责解释",
			)
			.replace("## 二、本办法自发布之日起实施", "二、本办法自发布之日起实施");
	}
	repaired = repaired.replace(INLINE_PERCENT_MATH_RE, "$<value>%");
	repaired = repaired.replace(INLINE_RIGHT_ARROW_MATH_RE, "→");
	return repaired.replace(/(?<=\d%)\s+(?=[,，。；;])/g, "");
}

function normalizeHandbookFrontmatter(frontmatterLines: string[]): string[] {
	if (frontmatterLines.length < 2) {
		return frontmatterLines;
	}
	const handbookReaderFrontmatter = buildReaderFrontmatterLines({
		kind: "studentHandbookArticle",
		layout: "reference",
		measure: "wide",
	});
	const rewritten = [frontmatterLines[0] ?? "---"];
	const fields: string[] = [];
	let seenCorpus = false;
	let seenCollection = false;
	let seenDocumentKind = false;
	let seenFooter = false;
	let seenReaderLayout = false;
	let seenReaderMeasure = false;
	let seenReaderOutline = false;
	for (const line of frontmatterLines.slice(1, -1)) {
		const stripped = line.trim();
		if (stripped.startsWith("corpus:")) {
			fields.push(`corpus: ${HANDBOOK_CORPUS}`);
			seenCorpus = true;
			continue;
		}
		if (stripped.startsWith("collection:")) {
			fields.push(`collection: ${HANDBOOK_COLLECTION}`);
			seenCollection = true;
			continue;
		}
		if (stripped.startsWith("footer:")) {
			fields.push("footer: false");
			seenFooter = true;
			continue;
		}
		if (stripped.startsWith("documentKind:")) {
			fields.push(...handbookReaderFrontmatter.slice(0, 1));
			seenDocumentKind = true;
			continue;
		}
		if (stripped.startsWith("readerLayout:")) {
			fields.push(...handbookReaderFrontmatter.slice(1, 2));
			seenReaderLayout = true;
			continue;
		}
		if (stripped.startsWith("readerMeasure:")) {
			fields.push(...handbookReaderFrontmatter.slice(2, 3));
			seenReaderMeasure = true;
			continue;
		}
		if (stripped.startsWith("readerProfile:")) {
			continue;
		}
		if (stripped.startsWith("readerOutline:")) {
			fields.push(...handbookReaderFrontmatter.slice(3));
			seenReaderOutline = true;
			continue;
		}
		fields.push(line);
	}
	if (!seenFooter) {
		const titleIndex = fields.findIndex((line) => line.trim().startsWith("title:"));
		fields.splice(titleIndex === -1 ? 0 : titleIndex + 1, 0, "footer: false");
	}
	if (!seenCorpus) {
		fields.push(`corpus: ${HANDBOOK_CORPUS}`);
	}
	if (!seenCollection) {
		fields.push(`collection: ${HANDBOOK_COLLECTION}`);
	}
	if (!seenDocumentKind) {
		fields.push(...handbookReaderFrontmatter.slice(0, 1));
	}
	if (!seenReaderLayout) {
		fields.push(...handbookReaderFrontmatter.slice(1, 2));
	}
	if (!seenReaderMeasure) {
		fields.push(...handbookReaderFrontmatter.slice(2, 3));
	}
	if (!seenReaderOutline) {
		fields.push(...handbookReaderFrontmatter.slice(3));
	}
	rewritten.push(...fields);
	rewritten.push(frontmatterLines.at(-1) ?? "---");
	return rewritten;
}

function frontmatterTitle(frontmatterLines: string[]): string | undefined {
	for (const line of frontmatterLines.slice(1, -1)) {
		const [key, ...rest] = line.split(":");
		if (key?.trim() === "title" && rest.length > 0) {
			return rest
				.join(":")
				.trim()
				.replace(/^['"]|['"]$/g, "");
		}
	}
	return;
}

function normalizeHandbookBody(lines: string[], title: string | undefined): string[] {
	const normalized: string[] = [];
	let sawChapterHeading = false;
	let pendingTableMarker = false;
	let htmlTableLines: string[] = [];
	const headingCounts = new Map<string, number>();

	for (const line of iterHandbookDisplayLines(lines)) {
		const stripped = line.trim();
		if (htmlTableLines.length > 0) {
			htmlTableLines.push(stripped);
			if (stripped.includes("</table>")) {
				appendHandbookTableBlocks(normalized, htmlTableLines.join("\n"));
				htmlTableLines = [];
				pendingTableMarker = false;
			}
			continue;
		}
		if (!stripped) {
			if (normalized.length > 0 && normalized.at(-1) !== "") {
				normalized.push("");
			}
			continue;
		}
		if (stripped === "[表格]") {
			pendingTableMarker = true;
			continue;
		}
		if (stripped.startsWith("<table")) {
			htmlTableLines = [stripped];
			if (stripped.includes("</table>")) {
				appendHandbookTableBlocks(normalized, htmlTableLines.join("\n"));
				htmlTableLines = [];
				pendingTableMarker = false;
			}
			continue;
		}
		if (pendingTableMarker) {
			normalized.push("[表格]", "");
			pendingTableMarker = false;
		}
		const headingText = stripped.replace(/^#+/, "").trim();
		const heading = normalizeHandbookHeading(stripped, { sawChapterHeading, title });
		if (heading !== undefined) {
			if (!heading) {
				continue;
			}
			const dedupedHeading = dedupeHandbookHeading(heading, headingCounts);
			if (normalized.length > 0 && normalized.at(-1) !== "") {
				normalized.push("");
			}
			normalized.push(dedupedHeading, "");
			if (HANDBOOK_CHAPTER_HEADING_RE.test(headingText)) {
				sawChapterHeading = true;
			}
			continue;
		}
		if (looksLikeHandbookLeadIn(stripped)) {
			if (normalized.length > 0 && normalized.at(-1) !== "") {
				normalized.push("");
			}
			normalized.push(renderHandbookLeadIn(stripped), "");
			continue;
		}
		if (
			normalized.length > 0 &&
			normalized.at(-1) !== "" &&
			(isMarkdownListItem(stripped) ||
				isHandbookParenthesizedEnumItem(stripped) ||
				((isMarkdownListItem(normalized.at(-1) ?? "") ||
					isHandbookParenthesizedEnumItem(normalized.at(-1) ?? "")) &&
					!(isMarkdownListItem(stripped) || isHandbookParenthesizedEnumItem(stripped))))
		) {
			normalized.push("");
		}
		normalized.push(...renderHandbookBodyLines(line.trimEnd()));
	}
	while (normalized.at(-1) === "") {
		normalized.pop();
	}
	return normalized;
}

function* iterHandbookDisplayLines(lines: string[]): Generator<string> {
	for (const line of iterHandbookSourceLines(lines)) {
		for (const displayLine of splitHandbookInlineDisplayBoundaries(line)) {
			yield displayLine;
		}
	}
}

function normalizeHandbookHeading(
	line: string,
	options: { title: string | undefined; sawChapterHeading: boolean },
): string | undefined {
	let text = line.startsWith("#") ? line.replace(/^#+/, "").trim() : line.replace(/^#/, "").trim();
	text = text.replace(/[：:；;，,。. ]+$/g, "");
	if (options.title && text === options.title) {
		return "";
	}
	if (isKnownHandbookFinalNumberedClauseHeading(options.title, text)) {
		return `## ${text}`;
	}
	if (looksLikeHandbookNumberedClauseHeading(options.title, text)) {
		return `## ${text}`;
	}
	if (HANDBOOK_CHAPTER_HEADING_RE.test(text)) {
		return `## ${text}`;
	}
	if (looksLikeHandbookInlineNumberedHeading(text)) {
		return `## ${text}`;
	}
	if (HANDBOOK_ARTICLE_HEADING_RE.test(text)) {
		return `${options.sawChapterHeading ? "###" : "##"} ${text}`;
	}
	return line.startsWith("#") ? `## ${text}` : undefined;
}

function looksLikeHandbookLeadIn(line: string): boolean {
	const normalized = line.trim();
	if (!normalized || normalized.startsWith("<") || normalized.startsWith("#")) {
		return false;
	}
	if (isMarkdownListItem(normalized) || HANDBOOK_CHAPTER_HEADING_RE.test(normalized)) {
		return false;
	}
	return HANDBOOK_LEAD_IN_RE.test(normalized);
}

function renderHandbookLeadIn(text: string): string {
	return `<p class="docs-lead-in">${escapeHtmlText(text.trim())}</p>`;
}

function looksLikeHandbookNumberedClauseHeading(title: string | undefined, text: string): boolean {
	return (
		title === "中央民族大学毕业生学费和国家助学贷款代偿暂行实施办法" &&
		HANDBOOK_NUMBERED_CLAUSE_HEADING_RE.test(text) &&
		text.length <= 72 &&
		!/[。！？!?；;]/.test(text)
	);
}

function isKnownHandbookFinalNumberedClauseHeading(
	title: string | undefined,
	text: string,
): boolean {
	if (title === "中央民族大学关于加强学生宿舍电器使用管理的规定") {
		return text === "五、本规定自公布之日起实施";
	}
	if (title === "中央民族大学学生课堂行为规范及课堂秩序管理办法") {
		return text === "四、本办法由学生工作部(处)负责解释";
	}
	return false;
}

function isMarkdownListItem(line: string): boolean {
	return MARKDOWN_ORDERED_LIST_RE.test(line) || MARKDOWN_UNORDERED_LIST_RE.test(line);
}

function isHandbookParenthesizedEnumItem(line: string): boolean {
	return /^[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]/.test(line.trim());
}

function* iterHandbookSourceLines(lines: string[]): Generator<string> {
	let index = 0;
	while (index < lines.length) {
		const current = (lines[index] ?? "").trimEnd();
		const stripped = current.trim();
		if (/^(?:\d+\.|[-*+])$/.test(stripped) && index + 1 < lines.length) {
			const nextLine = (lines[index + 1] ?? "").trim();
			if (nextLine) {
				yield `${stripped} ${nextLine}`;
				index += 2;
				continue;
			}
		}
		yield current;
		index += 1;
	}
}

function splitHandbookInlineDisplayBoundaries(line: string): string[] {
	const stripped = line.trim();
	if (!stripped || stripped.startsWith("<")) {
		return [line];
	}
	let splitLines = splitTextAtBoundaries(stripped, handbookInlineEnumBoundaries(stripped));
	splitLines = splitLines.flatMap((candidate) =>
		splitTextAtBoundaries(candidate, handbookInlineNumberedHeadingBoundaries(candidate)),
	);
	splitLines = splitLines.flatMap((candidate) => splitHandbookNumberedHeadingBody(candidate));
	return splitLines.length > 0 ? splitLines : [line];
}

function handbookInlineEnumBoundaries(text: string): number[] {
	const boundaries: number[] = [];
	for (const match of text.matchAll(HANDBOOK_INLINE_ENUM_MARKER_RE)) {
		const markerStart = match.index ?? -1;
		if (markerStart <= 0) {
			continue;
		}
		const prefix = text.slice(0, markerStart).trimEnd();
		if (
			prefix.endsWith(":") ||
			prefix.endsWith("：") ||
			prefix.endsWith(";") ||
			prefix.endsWith("；") ||
			prefix.endsWith("。") ||
			HANDBOOK_INLINE_ENUM_MARKER_RE.test(prefix)
		) {
			boundaries.push(markerStart);
		}
		HANDBOOK_INLINE_ENUM_MARKER_RE.lastIndex = 0;
	}
	return boundaries;
}

function handbookInlineNumberedHeadingBoundaries(text: string): number[] {
	const boundaries: number[] = [];
	for (const match of text.matchAll(HANDBOOK_INLINE_NUMBERED_HEADING_MARKER_RE)) {
		const markerStart = match.index ?? -1;
		if (markerStart <= 0) {
			continue;
		}
		const prefix = text.slice(0, markerStart).trimEnd();
		if (!(prefix.endsWith("。") || prefix.endsWith("；") || prefix.endsWith(";"))) {
			continue;
		}
		boundaries.push(markerStart);
	}
	return boundaries;
}

function splitTextAtBoundaries(text: string, boundaries: number[]): string[] {
	if (boundaries.length === 0) {
		return [text];
	}
	const parts: string[] = [];
	let cursor = 0;
	for (const boundary of [...new Set(boundaries)].sort((left, right) => left - right)) {
		const part = text.slice(cursor, boundary).trim();
		if (part) {
			parts.push(part);
		}
		cursor = boundary;
	}
	const tail = text.slice(cursor).trim();
	if (tail) {
		parts.push(tail);
	}
	return parts;
}

function splitHandbookNumberedHeadingBody(text: string): string[] {
	const normalized = text.trim();
	for (let splitIndex = 4; splitIndex <= Math.min(normalized.length, 24); splitIndex += 1) {
		const heading = normalized.slice(0, splitIndex).trim();
		if (!looksLikeHandbookInlineNumberedHeading(heading)) {
			continue;
		}
		const body = normalized.slice(splitIndex).trim();
		if (
			body &&
			!HANDBOOK_INLINE_HEADING_BODY_STARTERS.some((starter) => body.startsWith(starter))
		) {
			continue;
		}
		return body ? [heading, body] : [heading];
	}
	return [text];
}

function looksLikeHandbookInlineNumberedHeading(text: string): boolean {
	const normalized = text.trim();
	return (
		HANDBOOK_INLINE_NUMBERED_HEADING_RE.test(normalized) &&
		HANDBOOK_INLINE_HEADING_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
	);
}

function renderHandbookBodyLines(line: string): string[] {
	let escapedLine = escapeHandbookPlaceholderUnderscores(line);
	escapedLine = escapedLine.replace(/^(?<marker>\d+\.)(?=\d+月)/, "$<marker> ");
	escapedLine = escapedLine.replace(MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE, "$<marker> $<rest>");
	const decimalLabelMatch = MARKDOWN_DECIMAL_LABEL_RE.exec(escapedLine);
	if (decimalLabelMatch?.groups) {
		const escapedLabel = decimalLabelMatch.groups.label.replace(".", "\\.");
		return wrapMarkdownTextLines(`${escapedLabel}${decimalLabelMatch.groups.rest}`);
	}
	if (MARKDOWN_ORDERED_LIST_RE.test(escapedLine)) {
		const marker = escapedLine.split(" ", 1)[0] ?? "";
		const content = escapedLine.slice(marker.length + 1);
		return wrapMarkdownTextLines(content, {
			initialPrefix: `${marker} `,
			subsequentPrefix: " ".repeat(marker.length + 1),
		});
	}
	if (MARKDOWN_UNORDERED_LIST_RE.test(escapedLine)) {
		const marker = escapedLine.split(" ", 1)[0] ?? "";
		const content = escapedLine.slice(marker.length + 1);
		return wrapMarkdownTextLines(content, {
			initialPrefix: `${marker} `,
			subsequentPrefix: " ".repeat(marker.length + 1),
		});
	}
	return wrapMarkdownTextLines(escapedLine);
}

function dedupeHandbookHeading(heading: string, headingCounts: Map<string, number>): string {
	const [, ...textParts] = heading.split(" ");
	const text = textParts.join(" ");
	if (!text) {
		return heading;
	}
	headingCounts.set(text, (headingCounts.get(text) ?? 0) + 1);
	return heading;
}

function appendHandbookTableBlocks(lines: string[], html: string): void {
	if (shouldPreserveTableAsHtml(html)) {
		if (lines.length > 0 && lines.at(-1) !== "") {
			lines.push("");
		}
		lines.push(sanitizePreservedHtmlForMdx(html), "");
		return;
	}
	const blocks = convertTableHtmlToMarkdownBlocks(html);
	if (blocks.some(([blockType]) => blockType !== "table") || blocks.length === 0) {
		if (lines.length > 0 && lines.at(-1) !== "") {
			lines.push("");
		}
		lines.push(sanitizePreservedHtmlForMdx(html), "");
		return;
	}
	for (const [blockType, blockText] of blocks) {
		if (lines.length > 0 && lines.at(-1) !== "") {
			lines.push("");
		}
		if (blockType === "section_label") {
			lines.push(`### ${blockText.replace(/[：:；;，,。. ]+$/g, "")}`);
		} else {
			lines.push(...blockText.split(/\r?\n/));
		}
		lines.push("");
	}
}

function escapeHandbookPlaceholderUnderscores(line: string): string {
	return line.replaceAll("___", "\\_\\_\\_");
}
