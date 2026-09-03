import {
	NOTICE_CHUNK_DEFINITION,
	type NoticeChunkDefinition,
} from "../definitions.ts";
import { canonicalJsonBytes, sha256 } from "../encoding.ts";
import type {
	BuiltNoticeChunks,
	NoticeChunkStats,
	NoticeSource,
} from "../types.ts";
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
	const sourceSha256 = sha256(canonicalJsonBytes(source));
	const lines = parseSourceLines(source.contentText);
	const headings = detectHeadings(lines);
	const stats: NoticeChunkStats = {
		clauseSplitCount: 0,
		hardCutCount: 0,
		primaryHeadingCount: headings.filter((heading) => heading.level === 1).length,
		secondaryHeadingCount: headings.filter((heading) => heading.level === 2).length,
		sentenceSplitCount: 0,
		tableRowSplitCount: 0,
	};
	const units = buildSemanticUnits(lines, headings, source.contentText, definition);
	const pieces = units.flatMap((unit) =>
		buildUnitPieces(source.contentText, unit, stats, definition),
	);
	const chunks = combinePieces(source, sourceSha256, pieces, definition);
	if (chunks.length === 0) {
		throw new Error(`notice produced no chunks: ${source.noticeId}`);
	}
	return { chunks, definition, headings, source, sourceSha256, stats };
}
