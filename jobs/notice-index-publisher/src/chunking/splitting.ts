import { unicodeLength } from "../encoding.ts";
import type { NoticeChunkDefinition } from "../definitions.ts";
import type { NoticeChunkStats } from "../types.ts";
import * as model from "./model.ts";

export function splitLine(
	line: model.SourceLine,
	stats: NoticeChunkStats,
	definition: NoticeChunkDefinition,
): model.TextBlock[] {
	if (line.text.length === 0) {
		return [];
	}
	let remaining = line.text;
	let sourceStart = line.start;
	const result: model.TextBlock[] = [];
	while (unicodeLength(remaining) > definition.maxChars) {
		const characters = [...remaining];
		const split = splitIndex(characters, definition);
		const piece = characters.slice(0, split.index).join("");
		const sourceEnd = sourceStart + piece.length;
		result.push({ range: { end: sourceEnd, start: sourceStart } });
		incrementSplitStat(stats, split.reason);
		remaining = remaining.slice(piece.length);
		sourceStart = sourceEnd;
	}
	if (remaining.length > 0) {
		result.push({ range: { end: line.end, start: sourceStart } });
	}
	return result;
}

function splitIndex(
	characters: readonly string[],
	definition: NoticeChunkDefinition,
): { index: number; reason: model.SplitReason } {
	const max = Math.min(definition.maxChars, characters.length);
	const target = Math.min(definition.targetChars, max);
	for (const [reason, predicate] of [
		["sentence", sentenceBoundaryAt],
		["clause", clauseBoundaryAt],
	] as const) {
		for (let index = target; index <= max; index += 1) {
			if (predicate(characters, index)) {
				return { index, reason };
			}
		}
		for (let index = target - 1; index >= Math.max(1, Math.floor(target / 2)); index -= 1) {
			if (predicate(characters, index)) {
				return { index, reason };
			}
		}
	}
	return { index: max, reason: "hard" };
}

function sentenceBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!model.SENTENCE_END.test(punctuation) && punctuation !== ".") {
		return false;
	}
	if (punctuation !== ".") {
		return true;
	}
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	if (next === ".") {
		return false;
	}
	return !(model.unicodeLetterOrNumber(previous) && model.unicodeLetterOrNumber(next));
}

function clauseBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!model.CLAUSE_END.test(punctuation)) {
		return false;
	}
	if (punctuation !== "," && punctuation !== ":") {
		return true;
	}
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	return !(model.unicodeNumber(previous) && model.unicodeNumber(next));
}

function incrementSplitStat(stats: NoticeChunkStats, reason: model.SplitReason): void {
	if (reason === "sentence") {
		stats.sentenceSplitCount += 1;
	} else if (reason === "clause") {
		stats.clauseSplitCount += 1;
	} else {
		stats.hardCutCount += 1;
	}
}
