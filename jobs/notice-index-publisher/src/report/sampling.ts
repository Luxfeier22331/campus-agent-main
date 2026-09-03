import { unicodeLength } from "../encoding.ts";
import type { BuiltNoticeChunks, NoticeReviewSample, ReviewStratum } from "../types.ts";
import { storedNoticeChunk } from "../validation.ts";

const ARABIC_LIST = /(?:^|\n)[0-9]{1,2}[.、）)]\s*\S/u;
const REVIEW_SAMPLE_COUNT_PER_STRATUM = 6;

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

function compareNoticeIds(left: string, right: string): number {
	const leftNumber = BigInt(left);
	const rightNumber = BigInt(right);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}
