import { MAX_HEADING_CHARS, type NoticeChunkDefinition } from "../definitions.ts";
import { unicodeLength } from "../encoding.ts";
import type { DetectedHeading, SourceRange } from "../types.ts";
import * as lists from "./lists.ts";
import * as model from "./model.ts";
import * as tableModule from "./tables.ts";

export function parseSourceLines(value: string): model.SourceLine[] {
	const lines: model.SourceLine[] = [];
	let start = 0;
	let index = 0;
	while (start <= value.length) {
		const newline = value.indexOf("\n", start);
		const end = newline === -1 ? value.length : newline;
		lines.push({ end, index, start, text: value.slice(start, end) });
		index += 1;
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return lines;
}

export function detectHeadings(lines: readonly model.SourceLine[]): DetectedHeading[] {
	const candidates = lines.flatMap((line, index) => {
		const level = headingLevel(line.text) ??
			(isPunctuatedPrimaryHeading(lines, index) ? 1 : null);
		return level === null
			? []
			: [{ level, lineIndex: line.index, range: rangeOf(line), text: line.text.trim() }];
	});
	const candidateByLine = new Map(candidates.map((candidate) => [candidate.lineIndex, candidate]));
	return candidates.filter((candidate) => {
		let boundary = lines.length;
		for (const later of candidates) {
			if (later.lineIndex > candidate.lineIndex && later.level <= candidate.level) {
				boundary = later.lineIndex;
				break;
			}
		}
		for (let lineIndex = candidate.lineIndex + 1; lineIndex < boundary; lineIndex += 1) {
			const nested = candidateByLine.get(lineIndex);
			if (nested && nested.level > candidate.level) {
				return true;
			}
			const line = lines[lineIndex];
			if (
				line &&
				!nested &&
				line.text.length > 0 &&
				!isTrailingHeadingFooter(lines, lineIndex)
			) {
				return true;
			}
		}
		return false;
	});
}

function isPunctuatedPrimaryHeading(
	lines: readonly model.SourceLine[],
	index: number,
): boolean {
	const text = lines[index]?.text.trim() ?? "";
	if (!/。$/u.test(text)) return false;
	const match = text.match(
		/^(?:[一二三四五六七八九十百]+\s*[、.．]|第[一二三四五六七八九十百0-9]+(?:章|节|部分))\s*(\S.*)$/u,
	);
	const title = match?.[1]?.slice(0, -1).trim() ?? "";
	if (
		!title ||
		unicodeLength(title) > 20 ||
		/[，,：:。！？!?；;]/u.test(title) ||
		/^(?:请|须|应|需|必须|不得|禁止|凡|所有|逾期)/u.test(title)
	) {
		return false;
	}
	for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
		const next = lines[cursor]?.text.trim() ?? "";
		if (!next) continue;
		return (
			/^[（(][一二三四五六七八九十百]+[）)]\s*\S/u.test(next) ||
			model.listMarkerLevel(next) !== null
		);
	}
	return false;
}

function isTrailingHeadingFooter(lines: readonly model.SourceLine[], index: number): boolean {
	const text = lines[index]?.text ?? "";
	return (
		model.isSignatureLine(text) ||
		model.isClosingStart(lines, index) ||
		model.isFooterLine(lines, index)
	);
}

function headingLevel(value: string): 1 | 2 | null {
	const text = value.trim();
	if (!text || unicodeLength(text) > MAX_HEADING_CHARS || /[。！？!?；;]$/u.test(text)) {
		return null;
	}
	if (model.PRIMARY_HEADING.test(text)) {
		return 1;
	}
	if (model.SECONDARY_HEADING.test(text) && isSecondaryHeadingCandidate(text)) {
		return 2;
	}
	return null;
}

function isSecondaryHeadingCandidate(value: string): boolean {
	const match = value.trim().match(/^[（(][一二三四五六七八九十百]+[）)]\s*(.*)$/u);
	const body = match?.[1]?.trim() ?? "";
	if (!body) return false;

	const mainTitle = body.replace(/[（(][^（）()]*[）)]/gu, "").trim();
	const colonIndex = mainTitle.search(/[：:]/u);
	if (colonIndex >= 0 && mainTitle.slice(colonIndex + 1).trim().length > 0) {
		return false;
	}
	if (/[。！？!?；;…]/u.test(mainTitle) || /[，,]/u.test(mainTitle)) {
		return false;
	}
	// Short noun headings and dated material-submission phases can contain action words.
	// Undated instructions remain subject to the existing exclusion rules.
	if (
		(/^[^：:]{1,20}(?:内容|时间|形式|方式|要求)$/u.test(mainTitle) ||
			(/^[^：:]{1,20}(?:材料|提交|填报|报送)$/u.test(mainTitle) &&
				/[（(][^（）()]*\d{1,2}月\d{1,2}/u.test(body))) &&
		!/^(?:请|须|应|需|必须|不得|禁止|凡|所有)/u.test(mainTitle)
	)
		return true;
	return !/(?:^(?:请|须|应|需|必须|不得|禁止|凡|所有)|均为|只能|不允许|请于|须于|应于|需于|要在|负责|提交|填写|登录|扫描|报送)/u.test(
		body,
	);
}

export function buildSemanticUnits(
	lines: readonly model.SourceLine[],
	headings: readonly DetectedHeading[],
	sourceText: string,
	definition: NoticeChunkDefinition,
): model.SemanticUnit[] {
	const headingByLine = new Map(headings.map((heading) => [heading.lineIndex, heading]));
	const segments: model.BodySegment[] = [];
	let bodyLines: model.SourceLine[] = [];
	let hardSectionId = 0;
	let headingPath: string[] = [];
	let groupContext: string | undefined;
	let primaryHeading: DetectedHeading | undefined;
	const flush = () => {
		if (bodyLines.some((line) => line.text.length > 0)) {
			segments.push({
				bodyLines, hardSectionId, headingPath: [...headingPath],
				...(groupContext ? { groupContext } : {}),
			});
		}
		bodyLines = [];
	};

	for (const line of lines) {
		const heading = headingByLine.get(line.index);
		if (!heading && model.isGroupScopeStart(lines, line.index)) {
			flush();
			groupContext = line.text.trim();
			headingPath = primaryHeading ? [primaryHeading.text] : [];
			bodyLines.push(line);
			continue;
		}
		if (!heading) {
			bodyLines.push(line);
			continue;
		}
		flush();
		if (heading.level === 1) {
			groupContext = undefined;
			hardSectionId += 1;
			primaryHeading = heading;
			headingPath = [heading.text];
		} else {
			headingPath = primaryHeading ? [primaryHeading.text, heading.text] : [heading.text];
		}
	}
	flush();
	return segments.flatMap((segment) => {
		const units = buildSegmentUnits(segment, sourceText, definition);
		if (!segment.groupContext) return units;
		const primaryLength =
			segment.headingPath[0] && model.PRIMARY_HEADING.test(segment.headingPath[0]) ? 1 : 0;
		for (const unit of units) {
			const path = unit.retrievalHeadingPath ?? unit.headingPath;
			unit.retrievalHeadingPath = [
				...path.slice(0, primaryLength), segment.groupContext, ...path.slice(primaryLength),
			];
			unit.compositionKey = model.contextKey([segment.groupContext], [unit.compositionKey]);
		}
		return units;
	});
}

function buildSegmentUnits(
	segment: model.BodySegment,
	sourceText: string,
	definition: NoticeChunkDefinition,
): model.SemanticUnit[] {
	const lines = segment.bodyLines.filter((line) => line.text.length > 0);
	if (lines.length === 0) return [];
	const tables = tableModule.detectTableRegions(lines, segment.headingPath);
	const tableByHeader = new Map(tables.map((table) => [table.headerStartIndex, table]));
	const units: model.SemanticUnit[] = [];
	let unitId = 0;
	let index = 0;
	let pendingImageCaptions: model.SourceLine[] = [];

	const append = (unit: Omit<model.SemanticUnit, "unitId">) => {
		const bodyLines =
			pendingImageCaptions.length > 0
				? [...pendingImageCaptions, ...unit.bodyLines]
				: unit.bodyLines;
		pendingImageCaptions = [];
		units.push({ ...unit, bodyLines, unitId });
		unitId += 1;
	};

	while (index < lines.length) {
		const line = lines[index];
		if (!line) break;

		const table = tableByHeader.get(index);
		if (table) {
			tableModule.appendTableUnits(append, table, lines, sourceText, segment, definition);
			index = table.endIndex;
			continue;
		}

		const scope = model.localScope(lines, index);
		if (scope) {
			const children = buildSegmentUnits(
				{ ...segment, bodyLines: lines.slice(index + 1, scope.end) },
				sourceText,
				definition,
			);
			if (children.length > 0) {
				children[0]!.bodyLines.unshift(line);
				for (const child of children) {
					child.retrievalHeadingPath = model.withContext(segment.headingPath, [
						line.text,
						...(child.retrievalHeadingPath ?? child.headingPath).slice(segment.headingPath.length),
					]);
					child.compositionKey = model.contextKey([line.text], [child.compositionKey]);
					append(child);
				}
				index = scope.end;
				continue;
			}
		}

		if (model.isRecordStart(line.text) || model.isReportStart(lines, index)) {
			const end = lists.findNextRecordStart(lines, index + 1, tables);
			for (const unit of lists.buildRecordUnits(
				lines.slice(index, end),
				segment.headingPath,
				segment.hardSectionId,
			)) {
				append(unit);
			}
			index = end;
			continue;
		}

		if (model.isSignatureLine(line.text) || model.isClosingStart(lines, index)) {
			const previous = units.at(-1);
			if (previous && (previous.kind === "table-header" || previous.kind === "table-row")) {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: previous.compositionKey,
					hardSectionId: previous.hardSectionId,
					headingPath: [...previous.headingPath],
					joinSeparator: "\n",
					kind: "footer",
					protectedTailLineCount: 1,
				});
			} else if (previous) {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: model.contextKey(segment.headingPath, ["tail"]),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n\n",
					kind: "footer",
					protectedTailLineCount: 1,
				});
			}
			index += 1;
			continue;
		}

		if (model.isFooterLine(lines, index)) {
			const previous = units.at(-1);
			if (previous && previous.kind !== "table-header" && previous.kind !== "table-row") {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: previous?.compositionKey ?? model.sectionCompositionKey(segment.headingPath),
					hardSectionId: previous?.hardSectionId ?? segment.hardSectionId,
					headingPath: [...(previous?.headingPath ?? segment.headingPath)],
					joinSeparator: "\n",
					kind: "footer",
					protectedTailLineCount: 1,
				});
			}
			index += 1;
			continue;
		}

		if (model.isImageCaptionLine(line.text)) {
			const previous = units.at(-1);
			if (previous && previous.kind !== "table-header" && previous.kind !== "table-row") {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else if (previous) {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: previous.compositionKey,
					hardSectionId: previous.hardSectionId,
					headingPath: [...previous.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 1,
				});
			} else {
				pendingImageCaptions.push(line);
			}
			index += 1;
			continue;
		}

		if (model.isUrlLine(line.text)) {
			const previous = units.at(-1);
			if (previous) {
				previous.bodyLines.push(line);
				previous.protectedTailLineCount += 1;
			} else {
				append({
					atomic: true,
					bodyLines: [line],
					compositionKey: model.sectionCompositionKey(segment.headingPath),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 1,
				});
			}
			index += 1;
			continue;
		}

		if (model.isTopicLead(line.text)) {
			const end = findNextBoundary(lines, index + 1, tables);
			append({
				atomic: false,
				bodyLines: lines.slice(index, end),
				compositionKey: model.contextKey(segment.headingPath, [model.contextLabel(line.text)]),
				hardSectionId: segment.hardSectionId,
				headingPath: [...segment.headingPath],
				joinSeparator: "\n\n",
				kind: "text",
				protectedTailLineCount: 0,
			});
			index = end;
			continue;
		}

		if (model.isFieldGroupStart(lines, index)) {
			const end = findFieldGroupBoundary(
				lines,
				index + 1,
				tables,
			);
			for (const unit of buildFieldGroupUnits(lines.slice(index, end), {
				basePath: segment.headingPath,
				compositionKey: model.contextKey(segment.headingPath, ["field-group"]),
				hardSectionId: segment.hardSectionId,
			})) {
				append(unit);
			}
			index = end;
			continue;
		}

		if (model.isIndependentBracketListStart(lines, index)) {
			const end = lists.findListRunBoundary(lines, index, tables, 2);
			const listLines = lines.slice(index, end);
			if (lists.isSequentialList(listLines, segment.headingPath)) {
				append({
					atomic: false,
					bodyLines: listLines,
					compositionKey: model.contextKey(segment.headingPath, ["list-sequence"]),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 0,
				});
			} else {
				lists.appendIndependentListUnits(append, lines, index, end, tables, {
					basePath: segment.headingPath,
					hardSectionId: segment.hardSectionId,
					listLevel: 2,
				});
			}
			index = end;
			continue;
		}

		if (model.isTopLevelListItemStart(line.text)) {
			const end = lists.findListRunBoundary(lines, index, tables, 1);
			const listLines = lines.slice(index, end);
			if (lists.isSequentialList(listLines, segment.headingPath)) {
				append({
					atomic: false,
					bodyLines: listLines,
					compositionKey: model.contextKey(segment.headingPath, ["list-sequence"]),
					hardSectionId: segment.hardSectionId,
					headingPath: [...segment.headingPath],
					joinSeparator: "\n",
					kind: "text",
					protectedTailLineCount: 0,
				});
			} else {
				lists.appendIndependentListUnits(append, lines, index, end, tables, {
					basePath: segment.headingPath,
					hardSectionId: segment.hardSectionId,
					listLevel: 1,
				});
			}
			index = end;
			continue;
		}

		const end = findNextBoundary(lines, index + 1, tables);
		const textLines = lines.slice(index, end);
		append({
			atomic: false,
			bodyLines: textLines,
			compositionKey: model.sectionCompositionKey(segment.headingPath),
			hardSectionId: segment.hardSectionId,
			headingPath: segment.headingPath,
			kind: "text",
			protectedTailLineCount: 0,
		});
		index = end;
	}
	if (pendingImageCaptions.length > 0) {
		const trailingImageCaptions = pendingImageCaptions;
		pendingImageCaptions = [];
		append({
			atomic: true,
			bodyLines: trailingImageCaptions,
			compositionKey: model.sectionCompositionKey(segment.headingPath),
			hardSectionId: segment.hardSectionId,
			headingPath: [...segment.headingPath],
			joinSeparator: "\n",
			kind: "text",
			protectedTailLineCount: trailingImageCaptions.length,
		});
	}

	return units;
}

function buildFieldGroupUnits(
	lines: readonly model.SourceLine[],
	input: {
		basePath: readonly string[];
		compositionKey: string;
		hardSectionId: number;
	},
): Array<Omit<model.SemanticUnit, "unitId">> {
	const fieldGroups: model.SourceLine[][] = [];
	let current: model.SourceLine[] = [];
	let hasValue = false;
	const flush = () => {
		if (current.length > 0) fieldGroups.push(current);
		current = [];
		hasValue = false;
	};

	for (const [index, line] of lines.entries()) {
		const inlineField = model.isInlineLabelLead(line.text);
		const labelOnly = model.isLabelOnly(line.text) || model.isLocalLabel(lines, index);
		const parentLabel =
			current.length > 0 && (model.isLabelOnly(current[0]!.text) || model.isLocalLabel(current, 0));
		if (current.length > 0 && inlineField && hasValue && !parentLabel) {
			flush();
		} else if (current.length > 0 && labelOnly && hasValue) {
			flush();
		}
		current.push(line);
		if (inlineField || model.isUrlLine(line.text) || (model.isTopLevelListItemStart(line.text) && !labelOnly) || !labelOnly) {
			hasValue = true;
		}
	}
	flush();

	return fieldGroups.flatMap((fieldLines) =>
			splitFieldGroupUnits(fieldLines, {
			basePath: [...input.basePath],
			compositionKey: input.compositionKey,
			hardSectionId: input.hardSectionId,
		}),
	);
}

function splitFieldGroupUnits(
	lines: readonly model.SourceLine[],
	input: {
		basePath: string[];
		compositionKey: string;
		hardSectionId: number;
	},
): Array<Omit<model.SemanticUnit, "unitId">> {
	const listLevel = lists.siblingListLevel(lines);
	const markerIndexes = lines
		.map((line, index) =>
			listLevel !== null && model.listMarkerLevel(line.text) === listLevel ? index : -1,
		)
		.filter((index) => index >= 0);
	const starts = markerIndexes.slice(1);
	const listContext =
		listLevel === null
			? undefined
			: lines
					.slice(0, markerIndexes[0] ?? 0)
						.map((line) => line.text.trim())
						.filter(Boolean)
						.join(" ");
	const firstMarkerIndex = markerIndexes[0];
	if (listLevel !== null && firstMarkerIndex !== undefined && firstMarkerIndex > 0) {
		return [
			{
				atomic: true,
				bodyLines: [...lines],
				compositionKey: input.compositionKey,
				hardSectionId: input.hardSectionId,
				headingPath: [...input.basePath],
				joinSeparator: "\n",
				kind: "field",
				protectedTailLineCount: 0,
			},
		];
	}
	const boundaries = [0, ...starts, lines.length];
	if (
		listLevel !== null &&
		starts.length > 0 &&
		lists.isSequentialList(lines, input.basePath)
	) {
		return [
			{
				atomic: false,
				bodyLines: [...lines],
				compositionKey: model.contextKey(input.basePath, ["list-sequence"]),
				hardSectionId: input.hardSectionId,
				headingPath: [...input.basePath],
				joinSeparator: "\n",
				kind: "text",
				protectedTailLineCount: 0,
			},
		];
	}
	const units: Array<Omit<model.SemanticUnit, "unitId">> = [];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? lines.length;
		const bodyLines = lines.slice(start, end);
		if (bodyLines.length === 0) continue;
		units.push({
			atomic: true,
			bodyLines: [...bodyLines],
			compositionKey:
				listLevel === null
					? input.compositionKey
					: model.contextKey(input.basePath, ["list"]),
			hardSectionId: input.hardSectionId,
			headingPath: [...input.basePath],
			joinSeparator: "\n",
				kind: listLevel === null ? "field" : "list-item",
				protectedTailLineCount: 0,
			...(listLevel === null
				? {}
				: {
						retrievalHeadingPath: lists.buildListRetrievalPath(
							input.basePath,
							listContext,
						),
					}),
		});
	}
	return units;
}

function findNextBoundary(
	lines: readonly model.SourceLine[],
	start: number,
	tables: readonly model.TableRegion[],
): number {
	for (let index = start; index < lines.length; index += 1) {
				if (tableModule.isTableStart(index, tables)) return index;
		const text = lines[index]?.text ?? "";
		if (
			model.isRecordStart(text) ||
			model.isReportStart(lines, index) ||
			model.isTopicLead(text) ||
			model.isIndependentBracketListStart(lines, index) ||
			model.isTopLevelListItemStart(text) ||
			model.localScope(lines, index) !== null ||
			(model.isFieldLabelStart(lines, index) && !model.isListItemStart(text)) ||
			model.isSignatureLine(text) ||
			model.isClosingStart(lines, index) ||
			model.isFooterLine(lines, index) ||
			model.isImageCaptionLine(text)
		) {
			return index;
		}
	}
	return lines.length;
}

function findFieldGroupBoundary(
	lines: readonly model.SourceLine[],
	start: number,
	tables: readonly model.TableRegion[],
): number {
	const previous = lines[start - 1];
	let hasValue = Boolean(
		previous &&
			(model.isInlineLabelLead(previous.text) ||
				model.isUrlLine(previous.text) ||
				model.isTopLevelListItemStart(previous.text) ||
				!model.isLabelOnly(previous.text)),
	);
	for (let index = start; index < lines.length; index += 1) {
		if (tableModule.isTableStart(index, tables)) return index;
		const text = lines[index]?.text ?? "";
		if (
			model.isRecordStart(text) ||
			model.isReportStart(lines, index) ||
			model.isTopicLead(text) ||
			model.isSignatureLine(text) ||
			model.isClosingStart(lines, index) ||
			model.isFooterLine(lines, index) ||
			model.isImageCaptionLine(text)
		) {
			return index;
		}
		if (model.localScope(lines, index)) return index;
		const blankBefore = model.hasBlankLineBetween(lines[index - 1], lines[index]);
		if (model.isUrlLine(text) || model.isListItemStart(text)) {
			hasValue = true;
			continue;
		}
		if (model.isFieldLabelStart(lines, index)) {
			if (blankBefore && hasValue) return index;
			continue;
		}
		if (blankBefore && hasValue) return index;
		hasValue = true;
	}
	return lines.length;
}

function rangeOf(line: model.SourceLine): SourceRange {
	return { end: line.end, start: line.start };
}
