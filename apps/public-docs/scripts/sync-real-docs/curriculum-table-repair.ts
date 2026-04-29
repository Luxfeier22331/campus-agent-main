import type { CurriculumRow } from "./curriculum-types";
import {
	extractHtmlTableRows,
	htmlRowTextSignature,
	normalizeTableBodyHeaderCells,
} from "./html-table";
import { normalizeReadableText } from "./readable-text";
import { normalizeText } from "./shared";

export function repairKnownCurriculumDocsTextArtifacts(title: string, text: string): string {
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

export function repairKnownCurriculumDocsTableHtml(title: string, rawHtml: string): string {
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

export function coalesceCurriculumTableContinuations(rows: CurriculumRow[]): CurriculumRow[] {
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
		let mergedHtml =
			normalizeText(row.html_readable) || normalizeText(row.html) || normalizeText(row.clean_text);
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
			const continuationHtml =
				normalizeText(candidate.html_readable) ||
				normalizeText(candidate.html) ||
				normalizeText(candidate.clean_text);
			if (mergedHtml && continuationHtml) {
				mergedHtml = mergeCurriculumTableHtml(mergedHtml, continuationHtml);
				didMerge = true;
			}
			nextIndex += 1;
		}
		if (didMerge) {
			const readableMergedHtml = normalizeReadableText(mergedHtml);
			mergedRow = {
				...row,
				clean_text: mergedHtml,
				html: mergedHtml,
				html_readable: readableMergedHtml,
				text_readable: readableMergedHtml,
			};
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
