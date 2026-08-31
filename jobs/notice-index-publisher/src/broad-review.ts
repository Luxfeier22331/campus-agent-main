import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { TINY_CHUNK_CHARS } from "./definitions.ts";
import { canonicalJsonBytes, encodeNdjson, sha256, unicodeLength } from "./encoding.ts";
import { artifactHex, readNoticeChunkRun } from "./run-reader.ts";
import { writeImmutable } from "./artifacts.ts";
import type { NoticeChunk, Sha256Ref } from "./types.ts";

type BroadReviewTag =
	| "arabic-list"
	| "boundary-risk"
	| "extreme-tiny-chunk"
	| "list-heavy"
	| "long-notice"
	| "long-unstructured"
	| "many-chunks"
	| "many-primary-sections"
	| "near-max-chunk"
	| "nested-structure"
	| "random-control"
	| "same-section-split"
	| "short-notice"
	| "single-chunk"
	| "table-like"
	| "time-contact-dense"
	| "tiny-heavy"
	| "very-long-notice";

type BroadReviewStratum = BroadReviewTag | "coverage-fill";

export const NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY = "broad-sample-v2" as const;

const BROAD_REVIEW_MANDATORY_TAGS = [
	"table-like",
	"boundary-risk",
	"long-unstructured",
	"extreme-tiny-chunk",
	"near-max-chunk",
	"very-long-notice",
] as const satisfies readonly BroadReviewTag[];

const BROAD_REVIEW_ADDITIONAL_STRATA = [
	{ name: "same-section-split", target: 45 },
	{ name: "list-heavy", target: 45 },
	{ name: "tiny-heavy", target: 25 },
	{ name: "nested-structure", target: 25 },
	{ name: "time-contact-dense", target: 20 },
	{ name: "many-chunks", target: 15 },
	{ name: "many-primary-sections", target: 10 },
	{ name: "long-notice", target: 8 },
	{ name: "short-notice", target: 8 },
	{ name: "single-chunk", target: 9 },
] as const satisfies readonly { name: BroadReviewTag; target: number }[];

export const NOTICE_BROAD_REVIEW_DEFINITION = {
	additionalStrata: BROAD_REVIEW_ADDITIONAL_STRATA,
	algorithm: "notice_chunk_broad_sample.v2",
	mandatoryTags: BROAD_REVIEW_MANDATORY_TAGS,
	randomControlTarget: 50,
	sampleTarget: 350,
} as const;

const BROAD_REVIEW_SCHEMA_VERSION = NOTICE_BROAD_REVIEW_DEFINITION.algorithm;

interface Distribution {
	max: number;
	min: number;
	p50: number;
	p75: number;
	p90: number;
	p95: number;
}

interface ReviewBoundary {
	boundaryIndex: number;
	nextChunkId: Sha256Ref;
	nextChunkIndex: number;
	nextFirstLine: string;
	nextStart: string;
	previousChunkId: Sha256Ref;
	previousChunkIndex: number;
	previousEnd: string;
	previousLastLine: string;
	risk: boolean;
	sameHeadingPath: boolean;
}

interface BroadReviewNotice {
	boundaries: ReviewBoundary[];
	chunks: NoticeChunk[];
	metrics: {
		arabicListLineCount: number;
		boundaryRiskCount: number;
		cellCount: number;
		chunkChars: Distribution;
		chunkCount: number;
		dateTimeContactSignals: number;
		lineCount: number;
		numericCellCount: number;
		primarySectionCount: number;
		sameSectionBoundaryCount: number;
		secondaryHeadingCount: number;
		shortCellRatio: number;
		tinyChunkCount: number;
		totalChars: number;
	};
	noticeId: string;
	primaryStratum?: BroadReviewStratum;
	tags: BroadReviewTag[];
	title: string;
}

interface BroadReviewCandidate {
	chunkIndex?: number;
	detail: string;
	noticeId: string;
	signal:
		| "continuation-without-local-label"
		| "near-max-multi-topic"
		| "orphan-signature"
		| "same-section-relation-risk"
		| "tiny-tail-signature"
		| "trailing-label";
	title: string;
	boundaryIndex?: number;
}

interface LogicalTableShape {
	cells: string[];
	tableLike: boolean;
}

export interface LocalBroadReviewResult {
	outputDirectory: string;
	populationChunkCount: number;
	populationNoticeCount: number;
	run: Sha256Ref;
	sampleCount: number;
}

export async function runLocalNoticeBroadReview(input: {
	artifactRoot: string;
	chunkRun: Sha256Ref;
}): Promise<LocalBroadReviewResult> {
	const runData = await readNoticeChunkRun(input.artifactRoot, input.chunkRun);
	const notices = [...runData.chunksByNoticeId.entries()]
		.map(([noticeId, chunks]) => analyzeNotice(noticeId, chunks))
		.sort(compareNoticeIds);
	const { sample, summary } = selectBroadReviewSample(
		notices,
	);
	const candidates = buildReviewCandidates(sample);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"reviews",
		"sha256",
		artifactHex(input.chunkRun),
		NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
	);
	const census = buildCensus(notices, input.chunkRun);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeJson(join(outputDirectory, "census.json"), census),
		writeJson(join(outputDirectory, "sample-summary.json"), summary),
		writeNdjson(join(outputDirectory, "broad-sample.ndjson"), sample),
		writeNdjson(
			join(outputDirectory, "review-sheet.ndjson"),
			sample.map(compactReviewRecord),
		),
		writeNdjson(join(outputDirectory, "review-candidates.ndjson"), candidates),
		writeJson(join(outputDirectory, "review-candidates-summary.json"), {
			candidateCount: candidates.length,
			noticeCount: new Set(candidates.map((candidate) => candidate.noticeId)).size,
			signals: Object.fromEntries(
				[...new Set(candidates.map((candidate) => candidate.signal))]
					.sort()
					.map((signal) => [
						signal,
						candidates.filter((candidate) => candidate.signal === signal).length,
					]),
			),
		}),
	]);
	return {
		outputDirectory,
		populationChunkCount: runData.chunks.length,
		populationNoticeCount: notices.length,
		run: input.chunkRun,
		sampleCount: sample.length,
	};
}

function analyzeNotice(noticeId: string, chunks: readonly NoticeChunk[]): BroadReviewNotice {
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
	const tags: BroadReviewTag[] = [];
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

export function selectBroadReviewSample(
	notices: readonly BroadReviewNotice[],
): { sample: BroadReviewNotice[]; summary: Record<string, unknown> } {
	const selected = new Map<string, BroadReviewNotice>();
	const stratumSummary: Array<Record<string, unknown>> = [];

	const selectAll = (name: BroadReviewTag): void => {
		const eligible = notices.filter((notice) => notice.tags.includes(name));
		let newNoticeCount = 0;
		for (const notice of stableNoticeSort(eligible, name)) {
			if (selected.has(notice.noticeId)) continue;
			selected.set(notice.noticeId, {
				...notice,
				primaryStratum: name,
			});
			newNoticeCount += 1;
		}
		stratumSummary.push({
			candidateCount: eligible.length,
			mode: "all",
			name,
			newNoticeCount,
		});
	};

	for (const tag of NOTICE_BROAD_REVIEW_DEFINITION.mandatoryTags) {
		selectAll(tag);
	}

	for (const stratum of NOTICE_BROAD_REVIEW_DEFINITION.additionalStrata) {
		const eligible = notices.filter((notice) => notice.tags.includes(stratum.name));
		const candidates = stableNoticeSort(
			eligible.filter((notice) => !selected.has(notice.noticeId)),
			stratum.name,
		);
		const picked = candidates.slice(0, stratum.target);
		for (const notice of picked) {
			selected.set(notice.noticeId, {
				...notice,
				primaryStratum: stratum.name,
			});
		}
		stratumSummary.push({
			candidateCount: eligible.length,
			name: stratum.name,
			newNoticeCount: picked.length,
			target: stratum.target,
		});
	}

	const controlCandidates = stableNoticeSort(
		notices.filter((notice) => !selected.has(notice.noticeId)),
		"random-control",
	);
	const controls = controlCandidates.slice(0, NOTICE_BROAD_REVIEW_DEFINITION.randomControlTarget);
	for (const notice of controls) {
		selected.set(notice.noticeId, {
			...notice,
			primaryStratum: "random-control",
		});
	}
	stratumSummary.push({
		candidateCount: controlCandidates.length,
		name: "random-control",
		newNoticeCount: controls.length,
		target: NOTICE_BROAD_REVIEW_DEFINITION.randomControlTarget,
	});

	const coverageFill = notices
		.filter((notice) => !selected.has(notice.noticeId))
		.sort(
			(left, right) =>
				stableNoticeRank("coverage-fill", left.noticeId).localeCompare(
					stableNoticeRank("coverage-fill", right.noticeId),
				) || compareNoticeIds(left, right),
		)
		.slice(0, Math.max(0, NOTICE_BROAD_REVIEW_DEFINITION.sampleTarget - selected.size));
	for (const notice of coverageFill) {
		selected.set(notice.noticeId, {
			...notice,
			primaryStratum: "coverage-fill",
		});
	}
	stratumSummary.push({
		candidateCount: notices.length,
		name: "coverage-fill",
		newNoticeCount: coverageFill.length,
		target: Math.max(
			0,
			NOTICE_BROAD_REVIEW_DEFINITION.sampleTarget -
				(selected.size - coverageFill.length),
		),
	});
	const sample = [...selected.values()].sort(
		(left, right) =>
			(left.primaryStratum ?? "").localeCompare(right.primaryStratum ?? "") ||
			compareNoticeIds(left, right),
	);
	const census = buildCensus(notices, `sha256:${"0".repeat(64)}` as Sha256Ref);
	const summary = {
		census: { ...census, run: undefined },
		definition: NOTICE_BROAD_REVIEW_DEFINITION,
		sampleChunkCount: sample.reduce((sum, notice) => sum + notice.metrics.chunkCount, 0),
		sampleCount: sample.length,
		sampleNoticeRatio: notices.length === 0 ? 0 : sample.length / notices.length,
		sampleTagCoverage: Object.fromEntries(
			allTags(notices).map((tag) => {
				const candidateCount = notices.filter((notice) => notice.tags.includes(tag)).length;
				const selectedCount = sample.filter((notice) => notice.tags.includes(tag)).length;
				return [
					tag,
					{
						candidateCount,
						ratio: candidateCount === 0 ? 0 : selectedCount / candidateCount,
						selectedCount,
					},
				];
			}),
		),
		strata: stratumSummary,
	};
	return { sample, summary };
}

function stableNoticeSort(
	notices: readonly BroadReviewNotice[],
	stratum: BroadReviewStratum,
): BroadReviewNotice[] {
	return [...notices].sort(
		(left, right) =>
			stableNoticeRank(stratum, left.noticeId).localeCompare(
				stableNoticeRank(stratum, right.noticeId),
			) || compareNoticeIds(left, right),
	);
}

function stableNoticeRank(stratum: BroadReviewStratum, noticeId: string): string {
	return sha256(`${NOTICE_BROAD_REVIEW_DEFINITION.algorithm}\0${stratum}\0${noticeId}`);
}

function buildCensus(
	notices: readonly BroadReviewNotice[],
	run: Sha256Ref,
): Record<string, unknown> {
	const chunks = notices.flatMap((notice) => notice.chunks);
	return {
		chunkCount: chunks.length,
		chunkLength: distribution(chunks.map((chunk) => unicodeLength(chunk.content))),
		chunkLengthBuckets: bucketCounts(
			chunks.map((chunk) => unicodeLength(chunk.content)),
			[120, 300, 600, 800, 1000, 1200],
		),
		noticeChunkCount: distribution(notices.map((notice) => notice.metrics.chunkCount)),
		noticeCount: notices.length,
		noticeLength: distribution(notices.map((notice) => notice.metrics.totalChars)),
		run,
		schemaVersion: BROAD_REVIEW_SCHEMA_VERSION,
		tagCounts: Object.fromEntries(
			allTags(notices).map((tag) => [
				tag,
				notices.filter((notice) => notice.tags.includes(tag)).length,
			]),
		),
	};
}

function buildReviewCandidates(notices: readonly BroadReviewNotice[]): BroadReviewCandidate[] {
	const candidates: BroadReviewCandidate[] = [];
	for (const notice of notices) {
		for (const chunk of notice.chunks) {
			const lines = nonemptyLines(chunk.content);
			const first = lines[0] ?? "";
			const last = lines.at(-1) ?? "";
			const chars = unicodeLength(chunk.content);
			if (chunk.chunkIndex > 0 && signatureLine(first)) {
				candidates.push(candidate(notice, chunk.chunkIndex, "orphan-signature", first));
			}
			if (
				chunk.chunkIndex === notice.chunks.length - 1 &&
				chars <= 40 &&
				signatureLike(lines)
			) {
				candidates.push(candidate(notice, chunk.chunkIndex, "tiny-tail-signature", chunk.content));
			}
			if (labelOnly(last)) {
				candidates.push(candidate(notice, chunk.chunkIndex, "trailing-label", last));
			}
			if (chunk.chunkIndex > 0 && continuationLike(first)) {
				candidates.push(
					candidate(notice, chunk.chunkIndex, "continuation-without-local-label", first),
				);
			}
			if (chars >= 1000 && topicCount(lines) >= 3) {
				candidates.push(candidate(notice, chunk.chunkIndex, "near-max-multi-topic", first));
			}
		}
		for (const boundary of notice.boundaries) {
			if (!boundary.sameHeadingPath) continue;
			if (labelOnly(boundary.previousLastLine) || signatureLine(boundary.nextFirstLine)) {
				candidates.push({
					boundaryIndex: boundary.boundaryIndex,
					detail: `${boundary.previousLastLine} => ${boundary.nextFirstLine}`,
					noticeId: notice.noticeId,
					signal: "same-section-relation-risk",
					title: notice.title,
				});
			}
		}
	}
	return [...new Map(candidates.map((item) => [JSON.stringify(item), item])).values()];
}

function candidate(
	notice: BroadReviewNotice,
	chunkIndex: number,
	signal: BroadReviewCandidate["signal"],
	detail: string,
): BroadReviewCandidate {
	return { chunkIndex, detail, noticeId: notice.noticeId, signal, title: notice.title };
}

function compactReviewRecord(notice: BroadReviewNotice): Record<string, unknown> {
	return {
		boundaries: notice.boundaries,
		chunks: notice.chunks.map((chunk) => ({
			chars: unicodeLength(chunk.content),
			chunkId: chunk.chunkId,
			chunkIndex: chunk.chunkIndex,
			headingPath: chunk.headingPath,
			preview: prefix(chunk.content, 320),
			retrievalPrefix: prefix(chunk.retrievalText, 420),
		})),
		metrics: notice.metrics,
		noticeId: notice.noticeId,
		primaryStratum: notice.primaryStratum,
		tags: notice.tags,
		title: notice.title,
	};
}

function distribution(values: readonly number[]): Distribution {
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

function bucketCounts(values: readonly number[], upperBounds: readonly number[]): Record<string, number> {
	const result: Record<string, number> = {};
	let lower = 0;
	for (const upper of upperBounds) {
		result[`${lower}-${upper - 1}`] = values.filter((value) => value >= lower && value < upper).length;
		lower = upper;
	}
	result[`${lower}+`] = values.filter((value) => value >= lower).length;
	return result;
}

function compareNoticeIds(left: BroadReviewNotice, right: BroadReviewNotice): number {
	const leftNumber = BigInt(left.noticeId);
	const rightNumber = BigInt(right.noticeId);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function allTags(notices: readonly BroadReviewNotice[]): BroadReviewTag[] {
	return [...new Set(notices.flatMap((notice) => notice.tags))].sort();
}

function matchCount(value: string, pattern: RegExp): number {
	return [...value.matchAll(pattern)].length;
}

function nonemptyLines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function signatureLine(value: string): boolean {
	return /^(?:[—-]{2,}|撰稿[:：]|供稿[:：]|作者[:：])/u.test(value);
}

function signatureLike(lines: readonly string[]): boolean {
	return lines.length <= 2 && lines.every((line) => signatureLine(line) || organizationOrDate(line));
}

function organizationOrDate(value: string): boolean {
	return (
		/(?:学院|研究院|党委|党总支|教务处|科研处|图书馆|学生处|研究生院|委员会)$/u.test(value) ||
		/^20\d{2}年\d{1,2}月\d{1,2}日$/u.test(value)
	);
}

function labelOnly(value: string): boolean {
	const text = value.trim();
	return (
		unicodeLength(text) <= 80 &&
		!/如下[：:]?$/u.test(text) &&
		/(?:名单|名录|如下|包括|要求|内容|安排|方式|流程|材料|学者|嘉宾|信息|说明|注意事项)[:：]?$/u.test(
			text,
		)
	);
}

function continuationLike(value: string): boolean {
	return /^(?:申报者|项目涉及|其中|同时|此外|上述|该项目|该课程|该团队|其余|有关)/u.test(value);
}

function topicCount(lines: readonly string[]): number {
	return lines.filter((line) =>
		/^(?:[一二三四五六七八九十百]+[、.．]|[（(][一二三四五六七八九十百]+[）)]|\d{1,2}[.、）)])/u.test(
			line,
		),
	).length;
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

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeImmutable(path, canonicalJsonBytes(value));
}

async function writeNdjson(path: string, records: readonly unknown[]): Promise<void> {
	const bytes = records.length === 0 ? new TextEncoder().encode("") : encodeNdjson(records);
	await writeImmutable(path, bytes);
}
