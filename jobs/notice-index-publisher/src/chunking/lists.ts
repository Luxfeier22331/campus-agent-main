import * as model from "./model.ts";
import * as tableModule from "./tables.ts";

export function buildRecordUnits(
	lines: readonly model.SourceLine[],
	basePath: readonly string[],
	hardSectionId: number,
): Array<Omit<model.SemanticUnit, "unitId">> {
	const identity = model.recordIdentity(lines[0]?.text ?? "") || "未命名记录";
	const recordPath = model.withContext(basePath, [`记录：${identity}`]);
	return [
		{
			atomic: true,
			bodyLines: [...lines],
			compositionKey: model.contextKey(recordPath, []),
			hardSectionId,
			headingPath: [...basePath],
			joinSeparator: "\n\n",
			kind: "record",
			protectedTailLineCount: 0,
		},
	];
}

export function findNextRecordStart(
	lines: readonly model.SourceLine[],
	start: number,
	tables: readonly model.TableRegion[],
): number {
	for (let index = start; index < lines.length; index += 1) {
		if (tableModule.isInsideTable(index, tables)) continue;
		if (model.isRecordStart(lines[index]?.text ?? "")) return index;
	}
	return lines.length;
}

export function findListItemBoundary(
	lines: readonly model.SourceLine[],
	start: number,
	tables: readonly model.TableRegion[],
	listLevel: 1 | 2,
): number {
	for (let index = start; index < lines.length; index += 1) {
		if (tableModule.isTableStart(index, tables)) return index;
		const text = lines[index]?.text ?? "";
		if (
			model.isRecordStart(text) ||
			model.isTopicLead(text) ||
			model.isSignatureLine(text) ||
			model.isClosingStart(lines, index) ||
			model.isFooterLine(lines, index)
		) {
			return index;
		}
		if (model.listMarkerLevel(text) === listLevel) return index;
		if (listLevel === 2 && model.isTopLevelListItemStart(text)) return index;
	}
	return lines.length;
}

export function findListRunBoundary(
	lines: readonly model.SourceLine[],
	start: number,
	tables: readonly model.TableRegion[],
	listLevel: 1 | 2,
): number {
	let cursor = start;
	while (cursor < lines.length && model.listMarkerLevel(lines[cursor]?.text ?? "") === listLevel) {
		const end = findListItemBoundary(lines, cursor + 1, tables, listLevel);
		if (end <= cursor) return cursor + 1;
		cursor = end;
	}
	return cursor;
}

export function appendIndependentListUnits(
	append: (unit: Omit<model.SemanticUnit, "unitId">) => void,
	lines: readonly model.SourceLine[],
	start: number,
	end: number,
	tables: readonly model.TableRegion[],
	input: {
		basePath: readonly string[];
		hardSectionId: number;
		listLevel: 1 | 2;
	},
): void {
	const itemGroups: model.SourceLine[][] = [];
	let cursor = start;
	while (cursor < end) {
		const itemEnd = Math.min(
			findListItemBoundary(lines, cursor + 1, tables, input.listLevel),
			end,
		);
		if (itemEnd <= cursor) break;
		itemGroups.push(lines.slice(cursor, itemEnd));
		cursor = itemEnd;
	}
	for (const itemLines of itemGroups) {
		if (hasConditionalNestedList(itemLines)) {
			appendListItemUnit(append, itemLines, input);
			continue;
		}
		appendIndependentListItemUnits(append, itemLines, input);
	}
}

export function hasConditionalNestedList(lines: readonly model.SourceLine[]): boolean {
	const nestedStarts = lines
		.map((line, index) =>
			index > 0 && model.listMarkerLevel(line.text) === 2 ? index : -1,
		)
		.filter((index) => index >= 0);
	if (nestedStarts.length < 2) return false;
	const parentText = lines
		.slice(0, nestedStarts[0])
		.map((line) => line.text.trim())
		.filter(Boolean)
		.join(" ");
	return /(?:以下|之一|包括|如下|任选|任一|满足)/u.test(parentText);
}

export function appendIndependentListItemUnits(
	append: (unit: Omit<model.SemanticUnit, "unitId">) => void,
	lines: readonly model.SourceLine[],
	input: {
		basePath: readonly string[];
		hardSectionId: number;
	},
): void {
	const nestedStarts = independentNestedListStarts(lines);
	if (!nestedStarts) {
		appendListItemUnit(append, lines, input);
		return;
	}
	const parentContext = lines[0]?.text.trim() ?? "";
	const boundaries = [nestedStarts[0], ...nestedStarts.slice(1), lines.length];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const start = index === 0 ? 0 : boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? lines.length;
		const bodyLines = lines.slice(start, end);
		if (bodyLines.length === 0) continue;
		appendListItemUnit(
			append,
			bodyLines,
			input,
			index === 0 ? undefined : parentContext,
		);
	}
}

export function appendListItemUnit(
	append: (unit: Omit<model.SemanticUnit, "unitId">) => void,
	lines: readonly model.SourceLine[],
	input: {
		basePath: readonly string[];
		hardSectionId: number;
	},
	listContext?: string,
): void {
	if (lines.length === 0) return;
	append({
		atomic: true,
		bodyLines: [...lines],
		compositionKey: model.contextKey(input.basePath, ["list"]),
		hardSectionId: input.hardSectionId,
		headingPath: [...input.basePath],
		joinSeparator: "\n",
		kind: "list-item",
		protectedTailLineCount: 0,
		retrievalHeadingPath: buildListRetrievalPath(
			input.basePath,
			listContext,
		),
	});
}

export function independentNestedListStarts(
	lines: readonly model.SourceLine[],
): number[] | null {
	const starts = lines
		.map((line, index) =>
			index > 0 && model.listMarkerLevel(line.text) === 2 ? index : -1,
		)
		.filter((index) => index >= 0);
	if (starts.length < 2) return null;
	const parentText = lines
		.slice(0, starts[0])
		.map((line) => line.text.trim())
		.filter(Boolean)
		.join(" ");
	const nestedLines = lines.slice(starts[0]);
	if (
		/(?:以下|之一|包括|如下|任选|任一|满足)/u.test(parentText) ||
		model.isLabelOnly(parentText) ||
		isSequentialList(nestedLines, [])
	) {
		return null;
	}
	return starts;
}

export function siblingListLevel(lines: readonly model.SourceLine[]): 1 | 2 | null {
	if (lines.some((line) => model.listMarkerLevel(line.text) === 1)) return 1;
	if (lines.some((line) => model.listMarkerLevel(line.text) === 2)) return 2;
	return null;
}

export function isSequentialList(
	lines: readonly model.SourceLine[],
	headingPath: readonly string[],
): boolean {
	const markerCount = lines.filter((line) => model.listMarkerLevel(line.text) !== null).length;
	if (markerCount < 2) return false;
	const headingText = headingPath.join(" ");
	const listText = lines.map((line) => line.text).join("\n");
	return (
		/(?:流程|步骤|办理程序|操作流程|操作步骤|程序|环节|顺序)/u.test(headingText) ||
		/(?:第[一二三四五六七八九十百0-9]+步|首先|其次|然后|随后|接着|最后|完成后|提交后|审核后|通过后|下一步)/u.test(
			listText,
		)
	);
}

export function buildListRetrievalPath(
	basePath: readonly string[],
	listContext?: string,
): string[] {
	return [
		...basePath,
		...(listContext ? [`列表项：${model.contextLabel(listContext)}`] : []),
	];
}
