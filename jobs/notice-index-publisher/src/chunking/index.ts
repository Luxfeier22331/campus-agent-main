import {
	NOTICE_CHUNK_DEFINITION,
	type NoticeChunkDefinition,
} from "../definitions.ts";
import type {
	BuiltNoticeChunks,
	NoticeAssetSection,
	NoticeChunkStats,
	NoticeSource,
} from "../types.ts";
import type { SourceLine } from "./model.ts";
import {
	buildSemanticUnits,
	detectHeadings,
	parseSourceLines,
} from "./source-structure.ts";
import {
	buildUnitPieces,
	combinePieces,
} from "./assembly.ts";

export function buildNoticeChunks(
	source: NoticeSource,
	definition: NoticeChunkDefinition = NOTICE_CHUNK_DEFINITION,
): BuiltNoticeChunks {
	if (!(source.noticeId && source.title) || source.contentText.length === 0) {
		throw new Error(`notice chunk source is invalid: ${source.noticeId || "unknown"}`);
	}
	const lines = parseSourceLines(source.contentText);
	const assetSectionByLine = assetSectionLines(source, lines);
	const headings = detectHeadings(lines, new Set(assetSectionByLine.keys()));
	const stats: NoticeChunkStats = {
		clauseSplitCount: 0,
		hardCutCount: 0,
		primaryHeadingCount: headings.filter((heading) => heading.level === 1).length,
		secondaryHeadingCount: headings.filter((heading) => heading.level === 2).length,
		sentenceSplitCount: 0,
		tableRowSplitCount: 0,
	};
	const units = buildSemanticUnits(
		lines,
		headings,
		source.contentText,
		definition,
		assetSectionByLine,
	);
	const pieces = units.flatMap((unit) =>
		buildUnitPieces(source.contentText, unit, stats, definition),
	);
	const chunks = combinePieces(
		source,
		pieces,
		definition,
	);
	if (chunks.length === 0) {
		throw new Error(`notice produced no chunks: ${source.noticeId}`);
	}
	return { chunks, definition, headings, source, stats };
}

function assetSectionLines(
	source: NoticeSource,
	lines: readonly SourceLine[],
): Map<number, NoticeAssetSection> {
	const lineByStart = new Map(lines.map((line) => [line.start, line.index]));
	const result = new Map<number, NoticeAssetSection>();
	let previous = -1;
	for (const section of source.assetSections ?? []) {
		const lineIndex = lineByStart.get(section.start);
		if (lineIndex === undefined || section.start <= previous || section.heading === "") {
			throw new Error(`notice asset section is invalid: ${source.noticeId}/${section.start}`);
		}
		previous = section.start;
		result.set(lineIndex, section);
	}
	return result;
}
