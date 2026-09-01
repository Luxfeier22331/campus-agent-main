import { TINY_CHUNK_CHARS } from "./definitions.ts";
import { unicodeLength } from "./encoding.ts";
import type {
	BroadReviewNotice,
	LogicalTableShape,
} from "./broad-review-model.ts";
import type { NoticeChunk } from "./types.ts";

export function analyzeNotice(noticeId: string, chunks: readonly NoticeChunk[]): BroadReviewNotice {
	const orderedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
	const title = orderedChunks[0]?.retrievalText.split("\n", 1)[0] ?? "";
	if (!title) throw new Error(`notice title is missing from chunks: ${noticeId}`);
	if (orderedChunks.some((chunk) => chunk.retrievalText.split("\n", 1)[0] !== title)) {
		throw new Error(`notice title changed across chunks: ${noticeId}`);
	}
	const text = orderedChunks.map((chunk) => chunk.content).join("\n");
	const physicalCells = text
		.split(/\n\s*\n/gu)
		.map((value) => value.trim())
		.filter(Boolean);
	const lines = text
		.split("\n")
		.map((value) => value.trim())
		.filter(Boolean);
	const logicalTable = analyzeLogicalTableShape(text, lines);
	const cells = logicalTable.tableLike ? logicalTable.cells : physicalCells;
	const chunkLengths = orderedChunks.map((chunk) => unicodeLength(chunk.content));
	const tinyChunkCount = chunkLengths.filter((length) => length < TINY_CHUNK_CHARS).length;
	const primaryPaths = new Set(
		orderedChunks.flatMap((chunk) => (chunk.headingPath[0] ? [chunk.headingPath[0]] : [])),
	);
	const secondaryHeadings = orderedChunks.flatMap((chunk) =>
		chunk.retrievalText
			.split("\n")
			.filter((line) => /^[（(][一二三四五六七八九十百]+[）)]\s*\S/u.test(line.trim())),
	);
	const arabicListLineCount = lines.filter((line) =>
		/^\d{1,3}[.、）)]\s*\S/u.test(line),
	).length;
	const numericCellCount = cells.filter((cell) => /^\d{1,12}$/u.test(cell)).length;
	const shortCellRatio =
		cells.length === 0 ? 0 : cells.filter((cell) => unicodeLength(cell) <= 24).length / cells.length;
	const titleSuggestsTable = /名单|名册|结果|录取|获奖|公示/u.test(title);
	const tableLike =
		logicalTable.tableLike ||
		(cells.length >= 16 &&
			shortCellRatio >= 0.6 &&
			(numericCellCount >= 4 || (titleSuggestsTable && numericCellCount >= 2)));
	const boundaries = orderedChunks.slice(1).map((next, offset) => {
		const previous = orderedChunks[offset];
		if (!previous) throw new Error(`notice chunk order is invalid: ${noticeId}`);
		const previousLastLine = lastNonemptyLine(previous.content);
		const nextFirstLine = firstNonemptyLine(next.content);

		const sameHeadingPath = sameStrings(previous.headingPath, next.headingPath);
		const shortCellBoundary =
			unicodeLength(previousLastLine) <= 24 &&
			unicodeLength(nextFirstLine) <= 24 &&
			(previousLastLine.length > 0 || nextFirstLine.length > 0);
		const numericBoundary =
			/^\d{1,12}$/u.test(previousLastLine) || /^\d{1,12}$/u.test(nextFirstLine);
		return {
			boundaryIndex: offset,
			nextChunkId: next.chunkId,
			nextChunkIndex: next.chunkIndex,
			nextFirstLine,
			nextStart: prefix(next.content, 220),
			previousChunkId: previous.chunkId,
			previousChunkIndex: previous.chunkIndex,
			previousEnd: suffix(previous.content, 220),
			previousLastLine,
			risk: shortCellBoundary && (numericBoundary || tableLike),
			sameHeadingPath,
		};
	});
	const dateTimeContactSignals = matchCount(
		text,
		/(?:\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d{1,2}[:：]\d{2}|\b1\d{10}\b|\b\d{7,8}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/)/gu,
	);
	const totalChars = chunkLengths.reduce((sum, value) => sum + value, 0);
	const minimumChunkChars = Math.min(...chunkLengths);
	const maximumChunkChars = Math.max(...chunkLengths);
	const noHeading = orderedChunks.every((chunk) => chunk.headingPath.length === 0);
	const sameSectionBoundaryCount = boundaries.filter((boundary) => boundary.sameHeadingPath).length;
	const boundaryRiskCount = boundaries.filter((boundary) => boundary.risk).length;
	const tags = [] as BroadReviewNotice["tags"];
	if (tableLike) tags.push("table-like");
	if (minimumChunkChars <= 10) tags.push("extreme-tiny-chunk");
	if (maximumChunkChars >= 1000) tags.push("near-max-chunk");
	if (orderedChunks.length >= 10) tags.push("many-chunks");
	if (totalChars >= 3500) tags.push("very-long-notice");
	if (boundaryRiskCount > 0) tags.push("boundary-risk");
	if (sameSectionBoundaryCount > 0) tags.push("same-section-split");
	if (noHeading && totalChars > 1200) tags.push("long-unstructured");
	if (secondaryHeadings.length >= 2) tags.push("nested-structure");
	if (orderedChunks.length >= 3 && tinyChunkCount / orderedChunks.length >= 0.5) {
		tags.push("tiny-heavy");
	}
	if (arabicListLineCount >= 3) tags.push("list-heavy");
	if (dateTimeContactSignals >= 8) tags.push("time-contact-dense");
	if (totalChars <= 400) tags.push("short-notice");
	if (totalChars >= 2400) tags.push("long-notice");
	if (primaryPaths.size >= 6) tags.push("many-primary-sections");
	if (orderedChunks.length === 1) tags.push("single-chunk");
	return {
		boundaries,
		chunks: orderedChunks,
		metrics: {
			arabicListLineCount,
			boundaryRiskCount,
			cellCount: cells.length,
			chunkChars: distribution(chunkLengths),
			chunkCount: orderedChunks.length,
			dateTimeContactSignals,
			lineCount: lines.length,
			numericCellCount,
			primarySectionCount: primaryPaths.size,
			sameSectionBoundaryCount,
			secondaryHeadingCount: secondaryHeadings.length,
			shortCellRatio,
			tinyChunkCount,
			totalChars,
		},
		noticeId,
		tags,
		title,
	};
}

export function isLogicalNoticeTableLike(value: string): boolean {
	const lines = value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return analyzeLogicalTableShape(value, lines).tableLike;
}

function analyzeLogicalTableShape(text: string, lines: readonly string[]): LogicalTableShape {
	const fields = text
		.split(/[；;\n]/gu)
		.map(parseLogicalTableField)
		.filter((field): field is { label: string; value: string } => field !== null);
	const labelCounts = new Map<string, number>();
	for (const field of fields) {
		const label = field.label.replace(/\s+/gu, "");
		labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
	}
	const repeatedLabelCount = [...labelCounts.values()].filter((count) => count >= 2).length;
	const structuredLineCount = lines.filter(
		(line) =>
			line
				.split(/[；;]/u)
				.map(parseLogicalTableField)
				.filter((field): field is { label: string; value: string } => field !== null).length >= 2,
	).length;
	const tableLike =
		text.includes("；") &&
		fields.length >= 8 &&
		repeatedLabelCount >= 3 &&
		(structuredLineCount >= 2 || fields.length >= 16);
	return { cells: fields.map((field) => field.value), tableLike };
}

function parseLogicalTableField(value: string): { label: string; value: string } | null {
	const separator = value.search(/[：:]/u);
	if (separator <= 0) return null;
	const label = value.slice(0, separator).trim();
	const fieldValue = value.slice(separator + 1).trim();
	if (!label || !fieldValue || label.length > 80) return null;
	return { label, value: fieldValue };
}

function distribution(values: readonly number[]): BroadReviewNotice["metrics"]["chunkChars"] {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) return { max: 0, min: 0, p50: 0, p75: 0, p90: 0, p95: 0 };
	return {
		max: sorted.at(-1) ?? 0,
		min: sorted[0] ?? 0,
		p50: percentile(sorted, 0.5),
		p75: percentile(sorted, 0.75),
		p90: percentile(sorted, 0.9),
		p95: percentile(sorted, 0.95),
	};
}

function percentile(sorted: readonly number[], value: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
}

function matchCount(value: string, pattern: RegExp): number {
	return [...value.matchAll(pattern)].length;
}

function firstNonemptyLine(value: string): string {
	return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function lastNonemptyLine(value: string): string {
	return [...value.split("\n")].reverse().map((line) => line.trim()).find(Boolean) ?? "";
}

function prefix(value: string, length: number): string {
	const characters = [...value];
	return characters.length <= length ? value : `${characters.slice(0, length).join("")}…`;
}

function suffix(value: string, length: number): string {
	const characters = [...value];
	return characters.length <= length ? value : `…${characters.slice(-length).join("")}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
