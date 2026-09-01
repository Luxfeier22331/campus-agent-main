import {
	BASELINE_CHUNK_DEFINITION,
	NOTICE_CHUNK_DEFINITION,
	NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION,
	TINY_CHUNK_CHARS,
} from "./definitions.ts";
import { unicodeLength } from "./encoding.ts";
import { diagnoseBuild } from "./report-diagnostics.ts";
import { buildBaselineChunks, distribution, sum } from "./report-baseline.ts";
import type {
	BuiltNoticeChunks,
	NoticeChunkValidationReport,
} from "./types.ts";

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
		tinyChunkCount: chunks.filter((chunk) => unicodeLength(chunk.content) < TINY_CHUNK_CHARS).length,
	};
}
