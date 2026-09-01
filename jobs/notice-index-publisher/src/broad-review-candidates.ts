import { unicodeLength } from "./encoding.ts";
import type { BroadReviewCandidate, BroadReviewNotice } from "./broad-review-model.ts";

export function buildReviewCandidates(
	notices: readonly BroadReviewNotice[],
): BroadReviewCandidate[] {
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

export function compactReviewRecord(notice: BroadReviewNotice): Record<string, unknown> {
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

function candidate(
	notice: BroadReviewNotice,
	chunkIndex: number,
	signal: BroadReviewCandidate["signal"],
	detail: string,
): BroadReviewCandidate {
	return { chunkIndex, detail, noticeId: notice.noticeId, signal, title: notice.title };
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

function prefix(value: string, length: number): string {
	const characters = [...value];
	return characters.length <= length ? value : `${characters.slice(0, length).join("")}…`;
}
