import { buildCourseMapSectionBlock } from "./course-map";
import {
	convertTableHtmlToMarkdownBlocks,
	extractHtmlTableRows,
	htmlRowTextSignature,
	normalizeTableBodyHeaderCells,
} from "./html-table";
import {
	CURRICULUM_GROUPS,
	type CurriculumDocGroupId,
	classifyCurriculumDocGroupId,
	groupCurriculumDocsByIa,
} from "./ia";
import {
	type CourseMapDocEmbed,
	CURRICULUM_DOC_SLUG_OVERRIDES,
	type CurriculumDoc,
	escapeHtmlText,
	jsonString,
	MARKDOWN_DECIMAL_LABEL_RE,
	MARKDOWN_LIST_PREFIX_WITH_BREAK_RE,
	MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE,
	MARKDOWN_ORDERED_LIST_RE,
	MARKDOWN_UNORDERED_LIST_RE,
	normalizeText,
	sha1Hex,
	wrapMarkdownPlainText,
	wrapMarkdownTextLines,
} from "./shared";
import type { ObjectStoreClient } from "./storage";

const MARKDOWN_HEADING_BLOCK_RE = /^(#{1,6})\s+(.+)$/;
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

type CurriculumRow = Record<string, unknown>;
type MarkdownBlock = ["block" | "paragraph", string];

export function buildCurriculumPlanIndex(curriculumDocs: CurriculumDoc[] = []): string {
	const groups = groupCurriculumDocs(curriculumDocs);
	const lines = [
		"---",
		"title: 培养方案目录",
		"description: 中央民族大学公开培养方案目录。",
		"footer: false",
		"---",
		"",
		"这里汇总可公开阅读的培养方案、通识课程教学计划与专项培养文件。你可以使用顶部搜索按专业名称、课程类别或关键词快速定位内容。",
		"",
	];
	for (const group of groups) {
		if (group.docs.length === 0) {
			continue;
		}
		lines.push(`## ${group.label}`, "");
		for (const doc of group.docs) {
			lines.push(`- [${doc.title}](./${group.id}/${doc.slug})`);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export function groupCurriculumDocs(curriculumDocs: CurriculumDoc[]): CurriculumDocGroup[] {
	return groupCurriculumDocsByIa(curriculumDocs) as CurriculumDocGroup[];
}

export type CurriculumDocGroupLabel =
	| "本科专业与专业类"
	| "实验班与专项培养"
	| "强基计划"
	| "第二学士学位"
	| "通识课程"
	| "其他培养方案";

export interface CurriculumDocGroup {
	id: CurriculumDocGroupId;
	label: CurriculumDocGroupLabel;
	docs: CurriculumDoc[];
}

export function classifyCurriculumDocGroup(title: string): CurriculumDocGroupLabel {
	const groupId = classifyCurriculumDocGroupId(title);
	const group = CURRICULUM_GROUPS.find((candidate) => candidate.id === groupId);
	return (group?.label ?? "其他培养方案") as CurriculumDocGroupLabel;
}

export async function discoverCurriculumDocs(client: ObjectStoreClient): Promise<CurriculumDoc[]> {
	const keys = await client.listObjectKeys({ prefix: "curriculum/documents/curriculum_plan/" });
	const docs: CurriculumDoc[] = [];
	const seenSlugs = new Set<string>();
	for (const key of keys) {
		if (!key.endsWith("/document-units.jsonl")) {
			continue;
		}
		const jsonlText = await client.readTextObject({ key });
		const docId = resolveCurriculumDocId(jsonlText, key);
		const title = resolveCurriculumDocTitle(jsonlText, key);
		let slug = buildCurriculumDocSlug({ docId, title });
		if (seenSlugs.has(slug)) {
			slug = `${slug}-${sha1Hex(docId).slice(0, 10)}`;
		}
		if (seenSlugs.has(slug)) {
			throw new Error(`duplicate curriculum slug discovered: ${slug}`);
		}
		seenSlugs.add(slug);
		docs.push({ key, slug, title });
	}
	return docs.sort((left, right) => {
		const leftSort = sortCurriculumTitle(left.title);
		const rightSort = sortCurriculumTitle(right.title);
		if (leftSort[0] !== rightSort[0]) {
			return leftSort[0] - rightSort[0];
		}
		if (leftSort[1] < rightSort[1]) {
			return -1;
		}
		if (leftSort[1] > rightSort[1]) {
			return 1;
		}
		return 0;
	});
}

export function resolveCurriculumDocTitle(jsonlText: string, key: string): string {
	let docId = "";
	for (const row of iterRows(jsonlText)) {
		if (!docId) {
			docId = normalizeText(row.doc_id);
		}
		if (String(row.row_type ?? "") === "heading") {
			const headingText = normalizeText(row.clean_text);
			if (headingText) {
				return headingText;
			}
		}
	}
	if (docId.startsWith("curriculum:")) {
		return docId.split(":", 2)[1]?.trim() ?? "";
	}
	throw new Error(`unable to resolve curriculum title from: ${key}`);
}

export function buildCurriculumMarkdown(input: {
	title: string;
	jsonlText: string;
	slug?: string;
	courseMapEmbed?: CourseMapDocEmbed;
}): string {
	const lines = ["---", `title: ${jsonString(input.title)}`, "footer: false", "---", ""];
	if (input.courseMapEmbed) {
		lines.push(
			`import CourseMapSection from "${input.courseMapEmbed.componentImportPath}";`,
			`import ${input.courseMapEmbed.dataImportName} from "${input.courseMapEmbed.dataImportPath}";`,
			"",
		);
	}

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
					const headingText = normalizeCurriculumHeadingText(text);
					blocks.push(["block", `## ${headingText}`]);
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

function resolveCurriculumDocId(jsonlText: string, key: string): string {
	for (const row of iterRows(jsonlText)) {
		const docId = normalizeText(row.doc_id);
		if (docId) {
			return docId;
		}
	}
	throw new Error(`doc_id is required in curriculum document-units: ${key}`);
}

function buildCurriculumDocSlug(input: { docId: string; title: string }): string {
	const override = CURRICULUM_DOC_SLUG_OVERRIDES.get(input.docId);
	if (override) {
		return override;
	}
	const slug = input.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	return slug || `curriculum-plan-${sha1Hex(input.docId).slice(0, 10)}`;
}

function sortCurriculumTitle(title: string): [number, string] {
	return [title.includes("本科人才培养方案") ? 0 : 1, title];
}

function repairKnownCurriculumDocsTextArtifacts(title: string, text: string): string {
	if (!text || title !== "少数民族预科教育人才培养方案") {
		return text;
	}
	return text
		.replace("大学体育、心理健康主干课程:", "大学体育、心理健康。主干课程:")
		.replace("大学英语基础课程:", "大学英语。基础课程:")
		.replace(
			"大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语",
			"大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。",
		)
		.replace(/理科班增设普通化学和大学物理(?![。；])/g, "理科班增设普通化学和大学物理。");
}

function repairKnownCurriculumDocsTableHtml(title: string, rawHtml: string): string {
	if (!rawHtml) {
		return rawHtml;
	}
	let html = normalizeTableBodyHeaderCells(rawHtml);
	html = repairStaleCurriculumTableArtifacts(html);
	if (title === "少数民族预科教育人才培养方案") {
		html = html.replace(
			'<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr><tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>',
			'<table><tr><td colspan="5">文科班</td></tr><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td colspan="5">理科班</td></tr><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr><tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr><tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>',
		);
		return html.replace(
			'<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>',
			'<table><tr><td colspan="9">理科班</td></tr><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>',
		);
	}
	if (title === "民族学本科第二学士学位人才培养方案") {
		return html.replace(
			'<td rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td>',
			'<td rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>',
		);
	}
	return html;
}

function repairStaleCurriculumTableArtifacts(rawHtml: string): string {
	let html = rawHtml.replaceAll("学校通开的全球胜任力培养课程/", "学校通开的全球胜任力培养课程");
	html = html.replace(
		/<tr><td>跨学科<\/td>(?<firstRest>(?:<td[^>]*>.*?<\/td>)+)<\/tr><tr><td\s+rowspan="(?<rowspan>\d+)">交叉课程<\/td>(?<secondRest>(?:<td[^>]*>.*?<\/td>)+)<\/tr>/,
		(_match, firstRest: string, rowspanValue: string, secondRest: string) => {
			const rowspan = Number.parseInt(rowspanValue, 10);
			const repairedRowspan = Number.isFinite(rowspan) ? rowspan + 1 : 2;
			return `<tr><td rowspan="${repairedRowspan}">跨学科交叉课程</td>${firstRest}</tr><tr>${secondRest}</tr>`;
		},
	);
	return html;
}

function coalesceCurriculumTableContinuations(rows: CurriculumRow[]): CurriculumRow[] {
	const coalesced: CurriculumRow[] = [];
	let index = 0;
	while (index < rows.length) {
		const row = rows[index];
		if (!row || String(row.row_type ?? "") !== "table") {
			if (row) {
				coalesced.push(row);
			}
			index += 1;
			continue;
		}
		if (isCurriculumTableContinuation(row)) {
			coalesced.push(row);
			index += 1;
			continue;
		}
		const ownerRowId = normalizeText(row.row_id);
		const continuationGroupId = normalizeText(row.continuation_group_id) || ownerRowId;
		let mergedHtml = normalizeText(row.html) || normalizeText(row.clean_text);
		let mergedRow = row;
		let nextIndex = index + 1;
		let didMerge = false;
		while (nextIndex < rows.length) {
			const candidate = rows[nextIndex];
			if (!candidate) {
				nextIndex += 1;
				continue;
			}
			if (String(candidate.row_type ?? "") === "page_number") {
				nextIndex += 1;
				continue;
			}
			if (!isCurriculumTableContinuationOf(candidate, ownerRowId, continuationGroupId)) {
				break;
			}
			const continuationHtml = normalizeText(candidate.html) || normalizeText(candidate.clean_text);
			if (mergedHtml && continuationHtml) {
				mergedHtml = mergeCurriculumTableHtml(mergedHtml, continuationHtml);
				didMerge = true;
			}
			nextIndex += 1;
		}
		if (didMerge) {
			mergedRow = { ...row, clean_text: mergedHtml, html: mergedHtml };
		}
		coalesced.push(mergedRow);
		index = nextIndex;
	}
	return coalesced;
}

function isCurriculumTableContinuation(row: CurriculumRow): boolean {
	return (
		String(row.row_type ?? "") === "table" &&
		String(row.relation_type ?? "") === "table_continuation"
	);
}

function isCurriculumTableContinuationOf(
	row: CurriculumRow,
	ownerRowId: string,
	continuationGroupId: string,
): boolean {
	if (!isCurriculumTableContinuation(row)) {
		return false;
	}
	const rowOwnerId = normalizeText(row.owner_row_id);
	const rowGroupId = normalizeText(row.continuation_group_id);
	return Boolean(
		(ownerRowId && rowOwnerId === ownerRowId) ||
			(continuationGroupId && rowGroupId === continuationGroupId),
	);
}

function mergeCurriculumTableHtml(baseHtml: string, continuationHtml: string): string {
	const baseRows = extractHtmlTableRows(baseHtml);
	const continuationRows = extractHtmlTableRows(continuationHtml);
	if (baseRows.length === 0 || continuationRows.length === 0) {
		return normalizeTableBodyHeaderCells(`${baseHtml}\n${continuationHtml}`);
	}
	let rowsToAppend = continuationRows;
	const baseHeaderSignature = htmlRowTextSignature(baseRows[0] ?? "");
	const baseSecondSignature = baseRows.length > 1 ? htmlRowTextSignature(baseRows[1] ?? "") : "";
	const continuationSecondSignature =
		continuationRows.length > 1 ? htmlRowTextSignature(continuationRows[1] ?? "") : "";
	if (
		baseHeaderSignature &&
		htmlRowTextSignature(continuationRows[0] ?? "") === baseHeaderSignature
	) {
		rowsToAppend = continuationRows.slice(1);
		if (baseSecondSignature && continuationSecondSignature === baseSecondSignature) {
			rowsToAppend = continuationRows.slice(2);
		}
	}
	return normalizeTableBodyHeaderCells(`<table>${[...baseRows, ...rowsToAppend].join("")}</table>`);
}

function isCurriculumCourseMapHeading(text: string): boolean {
	return normalizeCurriculumHeadingText(text).includes("课程地图");
}

function appendCurriculumHeading(
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

function appendCurriculumStructuralHeadingBlock(
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

function appendCurriculumCaptionBlock(
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

function normalizeCurriculumHeadingText(text: string): string {
	return text
		.trim()
		.replace(/[：:。]+$/g, "")
		.trim();
}

function normalizeCurriculumHeadingLevel(
	sourceLevel: unknown,
	lastHeadingLevel: number | undefined,
): number {
	const rawLevel = Math.max(2, Math.min(6, parseCurriculumHeadingLevel(sourceLevel, 2)));
	if (lastHeadingLevel === undefined) {
		return 2;
	}
	return Math.max(2, Math.min(rawLevel, lastHeadingLevel + 1));
}

function parseCurriculumHeadingLevel(value: unknown, fallback: number): number {
	const parsed = Number.parseInt(String(value ?? fallback), 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function inferCurriculumStructuralLabelLevel(
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

function looksLikeCurriculumFigureOrTableCaption(text: string): boolean {
	return /^(表|图|附表|附图)\s*[0-9一二三四五六七八九十]/.test(text.trim());
}

function looksLikeCurriculumSpecialtyGraduationLabel(text: string): boolean {
	return CURRICULUM_SPECIALTY_GRADUATION_LABEL_RE.test(text.trim());
}

function looksLikeCurriculumLeadIn(text: string): boolean {
	const normalized = text.trim();
	return Boolean(
		normalized &&
			(CURRICULUM_LEAD_IN_RE.test(normalized) ||
				CURRICULUM_WEAK_SUBSECTION_LABEL_RE.test(normalized)),
	);
}

function splitCurriculumTrailingLeadIn(text: string): [string, string] | undefined {
	const match = CURRICULUM_TRAILING_LEAD_IN_RE.exec(text.trim());
	const body = match?.groups?.body?.trim();
	const intro = match?.groups?.intro?.trim();
	if (!(body && intro)) {
		return;
	}
	return [body, intro];
}

function splitCurriculumInlineArabicEnums(text: string): string[] {
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

function renderCurriculumLeadIn(text: string): string {
	return `<p className="docs-lead-in">${escapeHtmlText(text.trim())}</p>`;
}

function renderCurriculumTableCaption(text: string): string {
	return `<p className="docs-table-caption">${escapeHtmlText(text.trim())}</p>`;
}

function looksLikeCurriculumNestedModuleLabel(text: string): boolean {
	return /^模块[一二三四五六七八九十0-9]+[：:]/.test(text.trim());
}

function looksLikeCurriculumParenthesizedArabicHeading(text: string): boolean {
	return /^[（(]\d+[)）]/.test(text.trim());
}

function looksLikeCurriculumNumberedHeading(text: string): boolean {
	return /^(?:[（(]?\d+[)）.、]|[0-9]+[.．])/.test(text.trim());
}

function looksLikeCurriculumChineseParenthesizedHeading(text: string): boolean {
	return /^[（(][一二三四五六七八九十]+[)）]/.test(text.trim());
}

function looksLikeCurriculumCourseRequirementSentence(text: string): boolean {
	return /^[（(]\d+[)）]\s*.+课程.+\d+\s*学分[。.]?$/.test(text.trim());
}

function looksLikeCurriculumPracticeRequirementHeading(text: string): boolean {
	return /^(?:学年论文|综合实践|毕业设计)要求$/.test(text.trim());
}

function looksLikeCurriculumVersionNote(text: string): boolean {
	return /^[（(]?\d{4}\s*版[)）]?$/.test(text.trim());
}

function curriculumSameLevelHeadingFamily(text: string): string | undefined {
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

function shouldRenderCurriculumCaptionAsHeading(text: string): boolean {
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

function looksLikeCurriculumNoiseLabel(text: string): boolean {
	const normalized = text.trim();
	return !normalized || /^[（(]?[0-9一二三四五六七八九十]+[)）]?$/.test(normalized);
}

function normalizeCurriculumBodyText(value: unknown): string {
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

function isCurriculumCourseMapSectionBoundaryRow(text: string, row: CurriculumRow): boolean {
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

function* iterRows(jsonlText: string): Generator<CurriculumRow> {
	for (const line of jsonlText.split(/\r?\n/)) {
		const stripped = line.trim();
		if (stripped) {
			yield JSON.parse(stripped) as CurriculumRow;
		}
	}
}

function shouldMergeParagraph(previous: string, current: string): boolean {
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

function renderMarkdownBlockLines(blockText: string): string[] {
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
