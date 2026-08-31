import {
	BASELINE_CHUNK_DEFINITION,
	NOTICE_CHUNK_DEFINITION,
	NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION,
	TINY_CHUNK_CHARS,
} from "./definitions.ts";
import { unicodeLength } from "./encoding.ts";
import type {
	BuiltNoticeChunks,
	DistributionSummary,
	NoticeChunkValidationReport,
	NoticeReviewSample,
	ReviewStratum,
} from "./types.ts";
import { storedNoticeChunk } from "./validation.ts";

const ARABIC_LIST = /(?:^|\n)[0-9]{1,2}[.、）)]\s*\S/u;
const REVIEW_SAMPLE_COUNT_PER_STRATUM = 6;

interface BaselineChunk {
	content: string;
	end: number;
	start: number;
}

export function buildValidationReport(
	builds: readonly BuiltNoticeChunks[],
): NoticeChunkValidationReport {
	const definition = builds[0]?.definition ?? NOTICE_CHUNK_DEFINITION;
	const chunks = builds.flatMap((build) => build.chunks);
	const baselineChunks = builds.flatMap((build) => buildBaselineChunks(build.source.contentText));
	const baselinePrimaryBoundaryCrossingCount = builds.reduce((sum, build) => {
		const primaryOffsets = build.headings
			.filter((heading) => heading.level === 1)
			.map((heading) => heading.range.start);
		return (
			sum +
			buildBaselineChunks(build.source.contentText).reduce(
				(chunkSum, chunk) =>
					chunkSum +
					primaryOffsets.filter((offset) => offset > chunk.start && offset < chunk.end).length,
				0,
			)
		);
	}, 0);
	const diagnostics = builds.reduce(
		(total, build) => {
			const buildDiagnostics = diagnoseBuild(build);
			return {
				fieldValueSplitCount: total.fieldValueSplitCount + buildDiagnostics.fieldValueSplitCount,
				footerOnlyChunkCount: total.footerOnlyChunkCount + buildDiagnostics.footerOnlyChunkCount,
				headingContentDuplicateCount:
					total.headingContentDuplicateCount + buildDiagnostics.headingContentDuplicateCount,
				formalHeadingPathViolationCount:
					total.formalHeadingPathViolationCount + buildDiagnostics.formalHeadingPathViolationCount,
				listContinuationSplitCount:
					total.listContinuationSplitCount + buildDiagnostics.listContinuationSplitCount,
				orphanLabelCount: total.orphanLabelCount + buildDiagnostics.orphanLabelCount,
				secondaryBoundaryCrossingCount:
					total.secondaryBoundaryCrossingCount + buildDiagnostics.secondaryBoundaryCrossingCount,
				standaloneUrlCount: total.standaloneUrlCount + buildDiagnostics.standaloneUrlCount,
				tableHeaderContextMissingCount:
					total.tableHeaderContextMissingCount + buildDiagnostics.tableHeaderContextMissingCount,
				tableRowSplitCount: total.tableRowSplitCount + buildDiagnostics.tableRowSplitCount,
				urlOwnerSplitCount: total.urlOwnerSplitCount + buildDiagnostics.urlOwnerSplitCount,
			};
		},
		{
			fieldValueSplitCount: 0,
			footerOnlyChunkCount: 0,
			headingContentDuplicateCount: 0,
			formalHeadingPathViolationCount: 0,
			listContinuationSplitCount: 0,
			orphanLabelCount: 0,
			secondaryBoundaryCrossingCount: 0,
			standaloneUrlCount: 0,
			tableHeaderContextMissingCount: 0,
			tableRowSplitCount: 0,
			urlOwnerSplitCount: 0,
		},
	);
	return {
		baseline: {
			chunkChars: distribution(baselineChunks.map((chunk) => unicodeLength(chunk.content))),
			chunkCount: baselineChunks.length,
			definition: BASELINE_CHUNK_DEFINITION,
			primaryBoundaryCrossingCount: baselinePrimaryBoundaryCrossingCount,
		},
		chunkChars: distribution(chunks.map((chunk) => unicodeLength(chunk.content))),
		chunkCount: chunks.length,
		clauseSplitCount: sum(builds.map((build) => build.stats.clauseSplitCount)),
		definition,
		...diagnostics,
		hardCutCount: sum(builds.map((build) => build.stats.hardCutCount)),
		noticeCount: builds.length,
		noticesWithoutDetectedHeadings: builds.filter((build) => build.headings.length === 0).length,
		primaryBoundaryCrossingCount: 0,
		primaryHeadingCount: sum(builds.map((build) => build.stats.primaryHeadingCount)),
		schemaVersion: NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION,
		secondaryHeadingCount: sum(builds.map((build) => build.stats.secondaryHeadingCount)),
		sentenceSplitCount: sum(builds.map((build) => build.stats.sentenceSplitCount)),
		tinyChunkCount: chunks.filter((chunk) => unicodeLength(chunk.content) < TINY_CHUNK_CHARS)
			.length,
	};
}

function diagnoseBuild(build: BuiltNoticeChunks): {
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
} {
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
		const path = heading.level === 1
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
	return lines.length > 0 && lines.every((line) =>
		/^(?:[—–―]{1,3}\s*\S|撰稿[:：]|供稿[:：]|作者[:：])/u.test(line) ||
		/^(?:20\d{2}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)$/u.test(line) ||
		/(?:学院|大学|处|部|室|中心|委员会|研究院|研究生院|办公室|团委|党委|实验室|学校|协会|系)$/u.test(line),
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

function sharesOwner(left: ReadonlySet<number> | undefined, right: ReadonlySet<number> | undefined): boolean {
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

export function selectReviewSamples(
	builds: readonly BuiltNoticeChunks[],
): NoticeReviewSample[] {
	const strata: Array<{
		name: ReviewStratum;
		select: (build: BuiltNoticeChunks) => boolean;
	}> = [
		{ name: "short", select: (build) => unicodeLength(build.source.contentText) <= 400 },
		{
			name: "medium",
			select: (build) => {
				const length = unicodeLength(build.source.contentText);
				return length > 400 && length <= 1200;
			},
		},
		{
			name: "long-primary",
			select: (build) =>
				unicodeLength(build.source.contentText) > 1200 && build.stats.primaryHeadingCount > 0,
		},
		{
			name: "long-nested",
			select: (build) =>
				unicodeLength(build.source.contentText) > 1200 &&
				build.stats.primaryHeadingCount > 0 &&
				build.stats.secondaryHeadingCount > 0,
		},
		{
			name: "long-unstructured",
			select: (build) =>
				unicodeLength(build.source.contentText) > 1200 && build.headings.length === 0,
		},
		{
			name: "arabic-list",
			select: (build) => ARABIC_LIST.test(build.source.contentText),
		},
	];
	const used = new Set<string>();
	const result: NoticeReviewSample[] = [];
	for (const stratum of strata) {
		const candidates = builds
			.filter((build) => stratum.select(build) && !used.has(build.source.noticeId))
			.sort((left, right) => compareNoticeIds(left.source.noticeId, right.source.noticeId))
			.slice(0, REVIEW_SAMPLE_COUNT_PER_STRATUM);
		for (const build of candidates) {
			used.add(build.source.noticeId);
			result.push({
				chunks: build.chunks.map(storedNoticeChunk),
				contentText: build.source.contentText,
				noticeId: build.source.noticeId,
				stratum: stratum.name,
				title: build.source.title,
			});
		}
	}
	return result;
}

function buildBaselineChunks(value: string): BaselineChunk[] {
	const lineRanges = sourceLineRanges(value).flatMap((range) => splitBaselineRange(value, range));
	const chunks: BaselineChunk[] = [];
	let current: Array<{ end: number; start: number }> = [];
	const flush = () => {
		const first = current[0];
		const last = current.at(-1);
		if (!(first && last)) {
			return;
		}
		chunks.push({ content: value.slice(first.start, last.end), end: last.end, start: first.start });
		current = [];
	};
	for (const range of lineRanges) {
		const first = current[0];
		const currentText = first ? value.slice(first.start, current.at(-1)?.end ?? first.end) : "";
		const combined = first
			? value.slice(first.start, range.end)
			: value.slice(range.start, range.end);
		if (
			current.length > 0 &&
			(unicodeLength(currentText) >= BASELINE_CHUNK_DEFINITION.targetChars ||
				unicodeLength(combined) > BASELINE_CHUNK_DEFINITION.maxChars)
		) {
			flush();
		}
		current.push(range);
	}
	flush();
	return chunks;
}

function sourceLineRanges(value: string): Array<{ end: number; start: number }> {
	const result: Array<{ end: number; start: number }> = [];
	let start = 0;
	while (start <= value.length) {
		const newline = value.indexOf("\n", start);
		const end = newline === -1 ? value.length : newline;
		if (end > start) {
			result.push({ end, start });
		}
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return result;
}

function splitBaselineRange(
	value: string,
	range: { end: number; start: number },
): Array<{ end: number; start: number }> {
	const result: Array<{ end: number; start: number }> = [];
	let start = range.start;
	let remaining = value.slice(range.start, range.end);
	while (unicodeLength(remaining) > BASELINE_CHUNK_DEFINITION.maxChars) {
		const piece = [...remaining].slice(0, BASELINE_CHUNK_DEFINITION.maxChars).join("");
		result.push({ end: start + piece.length, start });
		start += piece.length;
		remaining = remaining.slice(piece.length);
	}
	if (remaining) {
		result.push({ end: range.end, start });
	}
	return result;
}

function distribution(values: readonly number[]): DistributionSummary {
	if (values.length === 0) {
		throw new Error("notice chunk distribution has no values");
	}
	const sorted = [...values].sort((left, right) => left - right);
	return {
		max: sorted.at(-1) ?? 0,
		p50: percentile(sorted, 0.5),
		p75: percentile(sorted, 0.75),
		p90: percentile(sorted, 0.9),
		p95: percentile(sorted, 0.95),
	};
}

function percentile(sorted: readonly number[], value: number): number {
	const index = Math.max(0, Math.ceil(sorted.length * value) - 1);
	return sorted[index] ?? 0;
}

function compareNoticeIds(left: string, right: string): number {
	const leftNumber = BigInt(left);
	const rightNumber = BigInt(right);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
