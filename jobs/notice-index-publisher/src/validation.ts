import { unicodeLength } from "./encoding.ts";
import type { BuiltNoticeChunk, BuiltNoticeChunks, NoticeChunk, SourceRange } from "./types.ts";

export function assertValidNoticeChunks(build: BuiltNoticeChunks): void {
	if (build.chunks.length === 0) {
		throw new Error(`notice has no chunks: ${build.source.noticeId}`);
	}
	const coverage = new Uint8Array(build.source.contentText.length);
	for (const heading of build.headings) {
		markRange(coverage, heading.range, 1, build.source.noticeId);
	}

	for (const [index, chunk] of build.chunks.entries()) {
		if (chunk.chunkIndex !== index) {
			throw new Error(`notice chunk indexes are not contiguous: ${build.source.noticeId}`);
		}
		if (chunk.noticeId !== build.source.noticeId || chunk.content.length === 0) {
			throw new Error(`notice chunk identity or content is invalid: ${chunk.chunkId}`);
		}
		if (unicodeLength(chunk.content) > build.definition.maxChars) {
			throw new Error(`notice chunk exceeds the character limit: ${chunk.chunkId}`);
		}
		const expectedContent = chunk.parts.reduce((content, part, partIndex) => {
			if (partIndex === 0) return part.content;
			return `${content}${part.joinSeparator ?? "\n\n"}${part.content}`;
		}, "");
		if (chunk.content !== expectedContent) {
			throw new Error(`notice chunk content provenance is invalid: ${chunk.chunkId}`);
		}
		if (chunk.retrievalText !== expectedRetrievalText(build.source.title, chunk)) {
			throw new Error(`notice chunk retrieval text is invalid: ${chunk.chunkId}`);
		}
		if (
			!sameStrings(
				chunk.headingPath,
				commonHeadingPath(chunk.parts.map((part) => part.headingPath)),
			)
		) {
			throw new Error(`notice chunk heading path is invalid: ${chunk.chunkId}`);
		}
		const hardSections = new Set(
			chunk.bodyRanges.map((range) => hardSectionForRange(range, build)),
		);
		if (hardSections.size !== 1 || !hardSections.has(chunk.hardSectionId)) {
			throw new Error(`notice chunk crosses a primary section: ${chunk.chunkId}`);
		}
		for (const part of chunk.parts) {
			const first = part.bodyRanges[0];
			const last = part.bodyRanges.at(-1);
			if (!(first && last)) {
				throw new Error(`notice chunk part has no source ranges: ${chunk.chunkId}`);
			}
			const expectedPart = build.source.contentText.slice(first.start, last.end);
			if (part.content !== expectedPart) {
				throw new Error(`notice chunk part does not match the source: ${chunk.chunkId}`);
			}
		}
		for (const range of chunk.bodyRanges) {
			markRange(coverage, range, 2, build.source.noticeId);
		}
	}

	for (let index = 0; index < coverage.length; index += 1) {
		if (coverage[index] === 0 && build.source.contentText[index] !== "\n") {
			throw new Error(
				`notice source text is absent from chunks: ${build.source.noticeId}/${index}`,
			);
		}
	}
}

export function assertValidChunkRun(builds: readonly BuiltNoticeChunks[]): void {
	if (builds.length === 0) {
		throw new Error("notice chunk source has no published text notices");
	}
	const noticeIds = new Set<string>();
	const chunkIds = new Set<string>();
	for (const build of builds) {
		if (noticeIds.has(build.source.noticeId)) {
			throw new Error(`notice chunk source is duplicated: ${build.source.noticeId}`);
		}
		noticeIds.add(build.source.noticeId);
		assertValidNoticeChunks(build);
		for (const chunk of build.chunks) {
			if (chunkIds.has(chunk.chunkId)) {
				throw new Error(`notice chunk identity is duplicated: ${chunk.chunkId}`);
			}
			chunkIds.add(chunk.chunkId);
		}
	}
}

export function storedNoticeChunk(chunk: BuiltNoticeChunk): NoticeChunk {
	return {
		chunkId: chunk.chunkId,
		chunkIndex: chunk.chunkIndex,
		content: chunk.content,
		headingPath: [...chunk.headingPath],
		noticeId: chunk.noticeId,
		retrievalText: chunk.retrievalText,
	};
}

function expectedRetrievalText(title: string, chunk: BuiltNoticeChunk): string {
	const lines = [title];
	let previousPath: string[] = [];
	for (const part of chunk.parts) {
		const path = part.retrievalHeadingPath ?? part.headingPath;
		const shared = commonPrefixLength(previousPath, path);
		lines.push(...path.slice(shared), part.content);
		previousPath = path;
	}
	return lines.join("\n");
}

function hardSectionForRange(range: SourceRange, build: BuiltNoticeChunks): number {
	return build.headings.filter(
		(heading) => heading.level === 1 && heading.range.start < range.start,
	).length;
}

function markRange(
	coverage: Uint8Array,
	range: SourceRange,
	value: number,
	noticeId: string,
): void {
	if (range.start < 0 || range.end <= range.start || range.end > coverage.length) {
		throw new Error(`notice source range is invalid: ${noticeId}/${range.start}-${range.end}`);
	}
	for (let index = range.start; index < range.end; index += 1) {
		if (coverage[index] !== 0) {
			throw new Error(`notice source range is covered more than once: ${noticeId}/${index}`);
		}
		coverage[index] = value;
	}
}

function commonHeadingPath(paths: readonly string[][]): string[] {
	const first = paths[0] ?? [];
	let length = first.length;
	for (const path of paths.slice(1)) {
		length = Math.min(length, commonPrefixLength(first, path));
	}
	return first.slice(0, length);
}

function commonPrefixLength(left: readonly string[], right: readonly string[]): number {
	let index = 0;
	while (index < left.length && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
