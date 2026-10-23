import { CHUNK_SET_DEFINITION } from "../definitions.ts";
import type { SplittableTextKind } from "./chunk-model.ts";
import { normalizeBlockText } from "./sections.ts";

export const MAX_TEXT_BYTES = 16_000;

export function splitOversizedText(
	value: string,
	kind: "blockquote" | "list" | "paragraph" = "paragraph",
): string[] {
	return splitTextByLimits(
		value,
		kind,
		CHUNK_SET_DEFINITION.chunking.targetChars,
		CHUNK_SET_DEFINITION.chunking.maxChars,
	);
}

export function splitTextByLimits(
	value: string,
	kind: SplittableTextKind,
	targetChars: number,
	maxChars: number,
): string[] {
	let remaining = normalizeBlockText(value);
	if (!remaining) return [];
	const result: string[] = [];
	while (unicodeLength(remaining) > maxChars) {
		const characters = [...remaining];
		const cut = textSplitIndex(characters, kind, targetChars, maxChars);
		const piece = normalizeBlockText(characters.slice(0, cut).join(""));
		if (piece) result.push(piece);
		remaining = normalizeBlockText(characters.slice(cut).join(""));
	}
	if (remaining) result.push(remaining);
	return result;
}

function textSplitIndex(
	characters: readonly string[],
	kind: SplittableTextKind,
	targetChars: number,
	maxChars: number,
): number {
	const max = Math.min(Math.max(1, maxChars), characters.length);
	const target = Math.min(Math.max(1, targetChars), max);
	const predicates: Array<(index: number) => boolean> = [
		(index) => characters[index - 2] === "\n" && characters[index - 1] === "\n",
		(index) => (kind === "list" || kind === "table") && characters[index - 1] === "\n",
		(index) => sentenceBoundaryAt(characters, index),
		(index) => clauseBoundaryAt(characters, index),
	];
	for (const predicate of predicates) {
		for (let index = target; index <= max; index += 1) {
			if (predicate(index)) return index;
		}
		for (let index = target - 1; index >= Math.max(1, Math.floor(target / 2)); index -= 1) {
			if (predicate(index)) return index;
		}
	}
	return max;
}

function sentenceBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!/[。！？.!?]/u.test(punctuation)) return false;
	if (punctuation !== ".") return true;
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	if (next === ".") return false;
	return !(unicodeLetterOrNumber(previous) && unicodeLetterOrNumber(next));
}

function clauseBoundaryAt(characters: readonly string[], index: number): boolean {
	const punctuation = characters[index - 1] ?? "";
	if (!/[；;，,、：:]/u.test(punctuation)) return false;
	if (punctuation !== "," && punctuation !== ":") return true;
	const previous = characters[index - 2] ?? "";
	const next = characters[index] ?? "";
	return !(unicodeNumber(previous) && unicodeNumber(next));
}

function unicodeLetterOrNumber(value: string): boolean {
	return /^[\p{L}\p{N}]$/u.test(value);
}

function unicodeNumber(value: string): boolean {
	return /^\p{N}$/u.test(value);
}

export function assertChunkSize(content: string, versionId: string): void {
	if (unicodeLength(content) > CHUNK_SET_DEFINITION.chunking.maxChars) {
		throw new Error(`Campus docs chunk exceeds Unicode character limit: ${versionId}`);
	}
	if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) {
		throw new Error(`Campus docs chunk exceeds byte limit: ${versionId}`);
	}
}

export function unicodeLength(value: string): number {
	return [...value].length;
}

export function orderedUnique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

export function orderedUniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const itemKey = key(value);
		if (seen.has(itemKey)) return false;
		seen.add(itemKey);
		return true;
	});
}
