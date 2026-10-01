import {
	TINY_CHUNK_CHARS,
	type NoticeChunkDefinition,
} from "../definitions.ts";
import {
	canonicalJsonBytes,
	sha256,
	unicodeLength,
} from "../encoding.ts";
import type {
	BuiltNoticeChunk,
	NoticeChunkStats,
	NoticeSource,
} from "../types.ts";
import * as model from "./model.ts";
import * as splitting from "./splitting.ts";
import * as tableModule from "./tables.ts";

export function buildUnitPieces(
	sourceText: string,
	unit: model.SemanticUnit,
	stats: NoticeChunkStats,
	definition: NoticeChunkDefinition,
): model.UnitPiece[] {
	if (
		unit.kind === "table-row" &&
		tableModule.sourceTextRangeLength(sourceText, unit.bodyLines) > definition.maxChars
	) {
		stats.tableRowSplitCount += 1;
	}
	const blocks = unit.bodyLines.flatMap((line) => splitting.splitLine(line, stats, definition));
	const pieces: Omit<model.UnitPiece, "wholeUnit">[] = [];
	let current: model.TextBlock[] = [];
	const flush = () => {
		const first = current[0];
		const last = current.at(-1);
		if (!(first && last)) {
			return;
		}
		pieces.push({
			atomic: unit.atomic,
			bodyRanges: current.map((block) => block.range),
			content: sourceText.slice(first.range.start, last.range.end),
				compositionKey: unit.compositionKey,
				hardSectionId: unit.hardSectionId,
			headingPath: [...unit.headingPath],
				joinSeparator: unit.joinSeparator ?? "\n\n",
				kind: unit.kind,
				unitId: unit.unitId,
			...(unit.retrievalHeadingPath
				? { retrievalHeadingPath: [...unit.retrievalHeadingPath] }
				: {}),
		});
		current = [];
	};

	for (const [blockIndex, block] of blocks.entries()) {
		const first = current[0];
		const currentContent = first
			? sourceText.slice(first.range.start, current.at(-1)?.range.end ?? first.range.end)
			: "";
		const combined = first
			? sourceText.slice(first.range.start, block.range.end)
			: sourceText.slice(block.range.start, block.range.end);
		const protectedTail =
			unit.protectedTailLineCount > 0 && blockIndex >= blocks.length - unit.protectedTailLineCount;
		if (
			current.length > 0 &&
			(unicodeLength(combined) > definition.maxChars ||
				(!unit.atomic && !protectedTail &&
					unicodeLength(currentContent) >= definition.targetChars))
		) {
			flush();
		}
		current.push(block);
	}
	flush();
	const wholeUnit = pieces.length === 1;
	return pieces.map((piece) => ({
		...piece,
		wholeUnit,
	}));
}

export function combinePieces(
	source: NoticeSource,
	sourceSha256: `sha256:${string}`,
	pieces: readonly model.UnitPiece[],
	definition: NoticeChunkDefinition,
): BuiltNoticeChunk[] {
	const chunks: BuiltNoticeChunk[] = [];
	let current: model.UnitPiece[] = [];
	const flush = () => {
		if (current.length === 0) {
			return;
		}
		const chunkIndex = chunks.length;
		const content = joinPieceContent(current);
		const headingPath = commonHeadingPath(current.map((piece) => piece.headingPath));
		const retrievalText = buildRetrievalText(source.title, current);
		const chunkId = sha256(
			canonicalJsonBytes({
				algorithm: definition.algorithm,
				chunkIndex,
				parts: current.map((piece) => ({
					bodyRanges: piece.bodyRanges,
					headingPath: piece.headingPath,
				})),
				sourceSha256,
			}),
		);
		chunks.push({
			bodyRanges: current.flatMap((piece) => piece.bodyRanges),
			chunkId,
			chunkIndex,
			content,
			hardSectionId: current[0]?.hardSectionId ?? 0,
			headingPath,
			noticeId: source.noticeId,
			...(source.releasedAt === undefined ? {} : { releasedAt: source.releasedAt }),
			parts: current.map(
				({
					bodyRanges,
					content: partContent,
					headingPath: path,
					joinSeparator,
					kind,
					retrievalHeadingPath,
				}) => ({
					bodyRanges,
					content: partContent,
					headingPath: path,
					joinSeparator,
					kind,
					...(retrievalHeadingPath
						? { retrievalHeadingPath: [...retrievalHeadingPath] }
						: {}),
				}),
			),
			retrievalText,
		});
		current = [];
	};

	for (const piece of pieces) {
		if (current.length === 0) {
			current.push(piece);
			continue;
		}
		const currentContent = joinPieceContent(current);
		const combinedContent = joinPieceContent([...current, piece]);
		const sameHardSection = current[0]?.hardSectionId === piece.hardSectionId;
		const sameComposition = current[0]?.compositionKey === piece.compositionKey;
		const onlyWholeUnits = piece.wholeUnit && current.every((item) => item.wholeUnit);
		const containsIndependentListItem =
			piece.kind === "list-item" || current.some((item) => item.kind === "list-item");
		const shortListItemRun =
			piece.kind === "list-item" &&
			isPackableShortListItem(piece.content) &&
			current.every(
					(item) =>
						item.kind === "list-item" && isPackableShortListItem(item.content),
			);
		const flatTextContext =
			current.every((item) => item.headingPath.length === 0) &&
			piece.headingPath.length === 0 &&
			current.every((item) => !isIsolatedUnitKind(item.kind)) &&
			!isIsolatedUnitKind(piece.kind);
		if (
			 sameHardSection &&
			(sameComposition || flatTextContext) &&
			(!containsIndependentListItem || shortListItemRun) &&
			onlyWholeUnits &&
			unicodeLength(currentContent) < definition.targetChars &&
			unicodeLength(combinedContent) <= definition.maxChars
		) {
			current.push(piece);
			continue;
		}
		flush();
		current.push(piece);
	}
	flush();
	return chunks;
}

function isIsolatedUnitKind(kind: model.SemanticUnitKind): boolean {
	return (
		kind === "list-item" ||
		kind === "record" ||
		kind === "table-header" ||
		kind === "table-row"
	);
}

function isPackableShortListItem(content: string): boolean {
	if (unicodeLength(content) >= TINY_CHUNK_CHARS) return false;
	return !content
		.split("\n")
		.some((line, index) => index > 0 && model.listMarkerLevel(line) === 2);
}

function joinPieceContent(
	pieces: readonly Pick<model.UnitPiece, "content" | "joinSeparator">[],
): string {
	return pieces
		.map((piece) => piece.content)
		.reduce((joined, content, index) => {
			if (index === 0) return content;
			const separator = pieces[index]?.joinSeparator ?? "\n\n";
			return `${joined}${separator}${content}`;
		}, "");
}

function buildRetrievalText(title: string, pieces: readonly model.UnitPiece[]): string {
	const lines = [title];
	let previousPath: string[] = [];
	for (const piece of pieces) {
		const path = piece.retrievalHeadingPath ?? piece.headingPath;
		const shared = commonPrefixLength(previousPath, path);
		lines.push(...path.slice(shared), piece.content);
		previousPath = path;
	}
	return lines.join("\n");
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
