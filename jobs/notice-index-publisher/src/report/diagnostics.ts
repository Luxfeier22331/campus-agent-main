import { unicodeLength } from "../encoding.ts";
import type { BuiltNoticeChunks } from "../types.ts";

export interface ReportBuildDiagnostics {
	fieldValueSplitCount: number;
	footerOnlyChunkCount: number;
	headingContentDuplicateCount: number;
	formalHeadingPathViolationCount: number;
	listContinuationSplitCount: number;
	orphanLabelCount: number;
	secondaryBoundaryCrossingCount: number;
	standaloneUrlCount: number;
	tableHeaderContextMissingCount: number;
	tableRowSplitCount: number;
	urlOwnerSplitCount: number;
}

export function diagnoseBuild(build: BuiltNoticeChunks): ReportBuildDiagnostics {
	const formalPaths = formalHeadingPaths(build);
	const sourceLines = sourceLinesOf(build.source.contentText);
	const owners = sourceLineOwners(build, sourceLines);
	const headingLineIndexes = new Set(build.headings.map((heading) => heading.lineIndex));
	const fieldValueSplitCount = countFieldValueSplits(sourceLines, owners, headingLineIndexes);
	const urlOwnerSplitCount = countUrlOwnerSplits(sourceLines, owners, headingLineIndexes);
	const listContinuationSplitCount = countListContinuationSplits(
		sourceLines,
		owners,
		headingLineIndexes,
		build.definition.maxChars,
	);
	return {
		fieldValueSplitCount,
		footerOnlyChunkCount: build.chunks.filter((chunk) => footerOnly(chunk.content)).length,
		headingContentDuplicateCount: build.chunks.filter((chunk) =>
			chunk.headingPath.some((heading) =>
				chunk.parts.some((part) => sameDiagnosticText(heading, firstNonemptyLine(part.content))),
			),
		).length,
		formalHeadingPathViolationCount: build.chunks.filter(
			(chunk) =>
				!isFormalPath(chunk.headingPath, formalPaths) ||
				chunk.parts.some((part) => !isFormalPath(part.headingPath, formalPaths)),
		).length,
		listContinuationSplitCount,
		orphanLabelCount: countOrphanLabels(sourceLines, owners, headingLineIndexes),
		secondaryBoundaryCrossingCount: build.chunks.filter((chunk) => {
			const secondaryPaths = new Set(
				chunk.parts
					.map((part) => JSON.stringify(part.headingPath.slice(1)))
					.filter((path) => path !== "[]"),
			);
			return secondaryPaths.size > 1;
		}).length,
		standaloneUrlCount: build.chunks.filter((chunk) => {
			const lines = nonemptyLines(chunk.content);
			return lines.length > 0 && lines.every(isUrlLine);
		}).length,
		tableHeaderContextMissingCount: build.chunks.filter((chunk) =>
			chunk.parts.some(
				(part) =>
					(part.kind === "table-row" || part.kind === "table-header") &&
					!(part.retrievalHeadingPath ?? []).some((path) => path.startsWith("表格列：")),
			),
		).length,
		tableRowSplitCount: build.stats.tableRowSplitCount,
		urlOwnerSplitCount,
	};
}

function formalHeadingPaths(build: BuiltNoticeChunks): Set<string> {
	const paths = new Set<string>();
	let primary: string | undefined;
	for (const heading of build.headings) {
		const path =
			heading.level === 1
				? [heading.text]
				: primary
					? [primary, heading.text]
					: [heading.text];
		paths.add(JSON.stringify(path));
		if (heading.level === 1) primary = heading.text;
	}
	return paths;
}

function isFormalPath(path: readonly string[], formalPaths: ReadonlySet<string>): boolean {
	return path.length === 0 || formalPaths.has(JSON.stringify(path));
}

function sameDiagnosticText(left: string, right: string): boolean {
	const normalize = (value: string) => value.trim().replace(/[\s：:。；;，,、]+$/gu, "");
	return normalize(left) === normalize(right);
}

function nonemptyLines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function firstNonemptyLine(value: string): string {
	return nonemptyLines(value)[0] ?? "";
}

function isSalutation(value: string): boolean {
	return /^(?:各|尊敬的|亲爱的|致|广大师生|全体(?:师生|教职工|学生))[^。！？!?；;]{0,100}[：:]$/u.test(
		value.trim(),
	);
}

function footerOnly(value: string): boolean {
	const lines = nonemptyLines(value);
	return (
		lines.length > 0 &&
		lines.every(
			(line) =>
				/^(?:[—–―]{1,3}\s*\S|撰稿[:：]|供稿[:：]|作者[:：])/u.test(line) ||
				/^(?:20\d{2}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)$/u.test(
					line,
				) ||
				/(?:学院|大学|处|部|室|中心|委员会|研究院|研究生院|办公室|团委|党委|实验室|学校|协会|系)$/u.test(
					line,
				)
		)
	);
}

interface ReportSourceLine {
	end: number;
	index: number;
	start: number;
	text: string;
}

type SourceLineOwners = ReadonlyMap<number, ReadonlySet<number>>;

function sourceLinesOf(value: string): ReportSourceLine[] {
	const lines: ReportSourceLine[] = [];
	let start = 0;
	let index = 0;
	while (start <= value.length) {
		const newline = value.indexOf("\n", start);
		const end = newline === -1 ? value.length : newline;
		lines.push({ end, index, start, text: value.slice(start, end) });
		index += 1;
		if (newline === -1) break;
		start = newline + 1;
	}
	return lines;
}

function sourceLineOwners(
	build: BuiltNoticeChunks,
	lines: readonly ReportSourceLine[],
): SourceLineOwners {
	const result = new Map<number, Set<number>>();
	for (const line of lines) {
		if (!line.text.trim()) continue;
		const owners = new Set<number>();
		for (const [chunkIndex, chunk] of build.chunks.entries()) {
			if (
				chunk.bodyRanges.some(
					(range) => range.start < line.end && range.end > line.start,
				)
			) {
				owners.add(chunkIndex);
			}
		}
		result.set(line.index, owners);
	}
	return result;
}

function countFieldValueSplits(
	lines: readonly ReportSourceLine[],
	owners: SourceLineOwners,
	headingLineIndexes: ReadonlySet<number>,
): number {
	let count = 0;
	for (const [index, line] of lines.entries()) {
		if (headingLineIndexes.has(line.index)) continue;
		if (isReportInlineField(line.text)) {
			const lineOwners = owners.get(line.index);
			if (lineOwners && lineOwners.size > 1) count += 1;
			continue;
		}
		if (!isReportLabelOnly(line.text)) continue;
		const next = nextNonemptyReportLine(lines, index + 1);
		if (!next || headingLineIndexes.has(next.line.index)) continue;
		if (!sharesOwner(owners.get(line.index), owners.get(next.line.index))) count += 1;
	}
	return count;
}

function countUrlOwnerSplits(
	lines: readonly ReportSourceLine[],
	owners: SourceLineOwners,
	headingLineIndexes: ReadonlySet<number>,
): number {
	let count = 0;
	for (const [index, line] of lines.entries()) {
		if (!isUrlLine(line.text)) continue;
		const previous = previousNonemptyReportLine(lines, index - 1);
		if (!previous || headingLineIndexes.has(previous.line.index)) continue;
		if (!sharesOwner(owners.get(line.index), owners.get(previous.line.index))) count += 1;
	}
	return count;
}

function countListContinuationSplits(
	lines: readonly ReportSourceLine[],
	owners: SourceLineOwners,
	headingLineIndexes: ReadonlySet<number>,
	maxChars: number,
): number {
	let count = 0;
	for (const [index, line] of lines.entries()) {
		if (!isReportTopLevelListStart(line.text) || headingLineIndexes.has(line.index)) continue;
		const itemLines: ReportSourceLine[] = [line];
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const candidate = lines[cursor];
			if (!candidate || headingLineIndexes.has(candidate.index)) break;
			if (isReportTopLevelListStart(candidate.text)) break;
			if (candidate.text.trim()) itemLines.push(candidate);
		}
		const first = itemLines[0];
		const last = itemLines.at(-1);
		if (
			!first ||
			!last ||
			unicodeLength(itemLines.map((item) => item.text).join("\n")) > maxChars
		) {
			continue;
		}
		const commonOwners = itemLines
			.map((item) => owners.get(item.index))
			.reduce<Set<number> | undefined>((common, current) => {
				if (!current) return common;
				if (!common) return new Set(current);
				return new Set([...common].filter((owner) => current.has(owner)));
			}, undefined);
		if (!commonOwners || commonOwners.size === 0) count += 1;
	}
	return count;
}

function countOrphanLabels(
	lines: readonly ReportSourceLine[],
	owners: SourceLineOwners,
	headingLineIndexes: ReadonlySet<number>,
): number {
	let count = 0;
	for (const [index, line] of lines.entries()) {
		if (!isReportLabelOnly(line.text) || headingLineIndexes.has(line.index)) continue;
		const next = nextNonemptyReportLine(lines, index + 1);
		if (next && !sharesOwner(owners.get(line.index), owners.get(next.line.index))) count += 1;
	}
	return count;
}

function nextNonemptyReportLine(
	lines: readonly ReportSourceLine[],
	start: number,
): { index: number; line: ReportSourceLine } | null {
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];
		if (line?.text.trim()) return { index, line };
	}
	return null;
}

function previousNonemptyReportLine(
	lines: readonly ReportSourceLine[],
	start: number,
): { index: number; line: ReportSourceLine } | null {
	for (let index = start; index >= 0; index -= 1) {
		const line = lines[index];
		if (line?.text.trim()) return { index, line };
	}
	return null;
}

function sharesOwner(
	left: ReadonlySet<number> | undefined,
	right: ReadonlySet<number> | undefined,
): boolean {
	if (!left || !right) return false;
	return [...left].some((owner) => right.has(owner));
}

function isReportLabelOnly(value: string): boolean {
	const text = value.trim();
	return (
		text.length > 1 &&
		text.length <= 100 &&
		/[：:]$/u.test(text) &&
		!isSalutation(text) &&
		!/(?:如下|具体如下)[：:]$/u.test(text)
	);
}

function isReportInlineField(value: string): boolean {
	const text = value.trim();
	const match = text.match(/^(.{1,80}?)[：:]\s*\S/u);
	return Boolean(match && !/[。！？!?；;]/u.test(match[1] ?? "") && !isUrlLine(text));
}

function isReportTopLevelListStart(value: string): boolean {
	return /^\d{1,3}\s*[.．、）)]\s*\S/u.test(value.trim());
}

function isUrlLine(value: string): boolean {
	return /^(?:https?:\/\/|mailto:)\S+$/u.test(value.trim());
}
