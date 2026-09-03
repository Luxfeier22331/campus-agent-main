import type { DocsReader } from "./campus-docs-types.ts";

export type ReaderSegmentationChangeKind =
	| "numbered_list"
	| "paragraph_with_numbered_list"
	| "paragraph_with_numbered_list_and_tail";

export interface ReaderSegmentationChange {
	kind: ReaderSegmentationChangeKind;
	rootUnitId: string;
}

export interface ReaderSegmentationUnresolvedBlock {
	rootUnitId: string;
	text: string;
}

export interface CleanReaderSegmentationResult {
	changes: ReaderSegmentationChange[];
	reader: DocsReader;
	unresolved: ReaderSegmentationUnresolvedBlock[];
}

interface SegmentationMatch {
	kind: ReaderSegmentationChangeKind;
	lines: string[];
}

export function cleanReaderSegmentation(reader: DocsReader): CleanReaderSegmentationResult {
	const changes: ReaderSegmentationChange[] = [];
	const unresolved: ReaderSegmentationUnresolvedBlock[] = [];
	const elements = reader.elements.map((element) => {
		if (element.kind !== "paragraph") {
			return element;
		}
		const match = matchHighConfidenceSegmentation(element.text);
		if (!(match && hasSingleLineBreak(element.text))) {
			if (!match && hasUnsegmentedLineBreak(element.text)) {
				unresolved.push({ rootUnitId: element.rootUnitId, text: element.text });
			}
			return element;
		}
		changes.push({ kind: match.kind, rootUnitId: element.rootUnitId });
		if (match.kind === "numbered_list") {
			return {
				...element,
				kind: "list" as const,
				text: match.lines.join("\n"),
			};
		}
		return {
			...element,
			text: match.lines.join("\n\n"),
		};
	});

	return {
		changes,
		reader: changes.length > 0 ? { ...reader, elements } : reader,
		unresolved,
	};
}

export function assertReaderSegmentationQuality(reader: DocsReader): void {
	const folded = reader.elements.flatMap((element) => {
		if (element.kind !== "paragraph") {
			return [];
		}
		return hasSingleLineBreak(element.text) && matchHighConfidenceSegmentation(element.text)
			? [element.rootUnitId]
			: [];
	});
	if (folded.length > 0) {
		throw new Error(
			`reader contains high-confidence folded numbered content: ${folded.slice(0, 3).join(", ")}`,
		);
	}
}

export function matchHighConfidenceSegmentation(text: string): SegmentationMatch | null {
	const lines = splitNonEmptyLines(text);
	if (!lines) {
		return null;
	}
	const pureList = parseContinuousNumberedLines(lines);
	if (pureList) {
		return { kind: "numbered_list", lines };
	}
	if (!endsWithColon(lines[0] ?? "")) {
		return null;
	}

	const body = lines.slice(1);
	if (parseContinuousNumberedLines(body)) {
		return { kind: "paragraph_with_numbered_list", lines };
	}
	if (body.length >= 3 && parseContinuousNumberedLines(body.slice(0, -1))) {
		return { kind: "paragraph_with_numbered_list_and_tail", lines };
	}
	return null;
}

function splitNonEmptyLines(text: string): string[] | null {
	if (!text.includes("\n")) {
		return null;
	}
	const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
	return lines.length >= 2 ? lines : null;
}

function hasUnsegmentedLineBreak(text: string): boolean {
	return text.includes("\n");
}

function hasSingleLineBreak(text: string): boolean {
	return text.split(/\n{2,}/u).some((part) => part.includes("\n"));
}

function endsWithColon(value: string): boolean {
	return /[：:]$/u.test(value.trim());
}

function parseContinuousNumberedLines(lines: readonly string[]): true | null {
	if (lines.length < 2) {
		return null;
	}
	return lines.every(parseNumberedLine) ? true : null;
}

function parseNumberedLine(value: string): boolean {
	return /^(?:\s*[（(](?:\d{1,3}|[〇零一二三四五六七八九十百]+)[）)]|\s*\d{1,3}[.．、）)]|\s*[〇零一二三四五六七八九十百]+[、.．）)])/u.test(
		value,
	);
}
