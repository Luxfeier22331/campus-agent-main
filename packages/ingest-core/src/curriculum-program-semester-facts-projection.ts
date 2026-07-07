import {
	authorizationRow,
	buildDigestVersionId,
	type CurriculumProjectionDocument,
	type CurriculumRawAssetRecord,
	type CurriculumSplitManifestDocument,
	cellHasValue,
	extractTableRows,
	normalizeText,
	PDF_OCR_SOURCE_CHANNEL,
	projectionDocument,
	resolvedVisibilityScope,
	rowPageEnd,
	rowPageStart,
	rowWithinDocument,
	SEMESTER_INDEX_TO_LABEL,
	SEMESTER_LABEL_TO_INDEX,
	sourceStatus,
} from "./curriculum-facts-shared.ts";

interface ProgramSemesterProjection {
	sourceDocument: CurriculumSplitManifestDocument;
	semesterLabel: string;
	courseTitles: readonly string[];
	pageStart: number;
	pageEnd: number;
}

interface CurriculumSemesterTableLayout {
	singleSemesterIndex: number;
	distributionSemesterIndexes: readonly [string, number][];
}

export function buildCurriculumProgramSemesterFactDocumentId(
	sourceDocumentId: string,
	semesterLabel: string,
): string {
	const suffix = sourceDocumentId.split(":").slice(1).join(":").trim();
	const semesterIndex =
		SEMESTER_LABEL_TO_INDEX[semesterLabel as keyof typeof SEMESTER_LABEL_TO_INDEX];
	if (!(suffix && semesterIndex)) {
		throw new Error("sourceDocumentId and semesterLabel must be resolvable");
	}
	return `program_semester_facts:${suffix}:semester-${semesterIndex}`;
}

export function buildCurriculumProgramSemesterFactsDocuments(input: {
	layoutElementsKey: string | null;
	providerResponseKey: string | null;
	rawAssetRecord: CurriculumRawAssetRecord;
	sourcePdf: string;
	splitManifestDocuments: readonly CurriculumSplitManifestDocument[];
	structuredRows: readonly Record<string, unknown>[];
	importSource?: string;
}): CurriculumProjectionDocument[] {
	const documents: CurriculumProjectionDocument[] = [];
	for (const sourceDocument of input.splitManifestDocuments) {
		if (sourceStatus(sourceDocument) !== "active") {
			continue;
		}
		for (const projection of buildProgramSemesterProjections({
			sourceDocument,
			structuredRows: input.structuredRows,
		})) {
			const documentId = buildCurriculumProgramSemesterFactDocumentId(
				sourceDocument.document_id,
				projection.semesterLabel,
			);
			const versionId = buildDigestVersionId(
				`${input.rawAssetRecord.raw_version_id}|${sourceDocument.document_id}|${projection.semesterLabel}`,
				`${input.rawAssetRecord.raw_version_id}:program-semester`,
			);
			const row = programSemesterDocumentUnit({
				documentId,
				projection,
				sourcePdf: input.sourcePdf,
				versionId,
			});
			documents.push(
				projectionDocument({
					additionalProcessedObjectKeys: input.layoutElementsKey ? [input.layoutElementsKey] : [],
					collection: "program_semester_facts",
					corpus: "curriculum",
					importSource: input.importSource ?? "provider_response_replay",
					providerResponseObjectKey: input.providerResponseKey,
					rawAssetRecord: input.rawAssetRecord,
					row,
					sourceChannel: PDF_OCR_SOURCE_CHANNEL,
					sourceLabel: input.providerResponseKey
						? `${input.providerResponseKey}#${documentId}`
						: `${input.rawAssetRecord.raw_source_uri}#${documentId}`,
					status: sourceStatus(sourceDocument),
					title: programSemesterProjectionTitle(projection),
					visibilityScope: resolvedVisibilityScope(sourceDocument),
					year: null,
				}),
			);
		}
	}
	return documents;
}

function buildProgramSemesterProjections(input: {
	sourceDocument: CurriculumSplitManifestDocument;
	structuredRows: readonly Record<string, unknown>[];
}): ProgramSemesterProjection[] {
	const courseTitlesBySemester = new Map<string, string[]>();
	const pageBoundsBySemester = new Map<string, [number, number]>();
	for (const row of input.structuredRows) {
		if (!rowWithinDocument(row, input.sourceDocument)) {
			continue;
		}
		const tableRows = extractTableRows(row);
		if (!tableRows.some((cells) => cells.includes("课程名称"))) {
			continue;
		}
		const projectionPageStart = rowPageStart(row, input.sourceDocument.page_start);
		const projectionPageEnd = rowPageEnd(row, input.sourceDocument.page_end);
		for (const [semesterLabel, courseTitles] of extractSemesterCourseTitles(tableRows)) {
			const titles = courseTitlesBySemester.get(semesterLabel) ?? [];
			for (const title of courseTitles) {
				if (!titles.includes(title)) {
					titles.push(title);
				}
			}
			courseTitlesBySemester.set(semesterLabel, titles);
			const bounds = pageBoundsBySemester.get(semesterLabel);
			pageBoundsBySemester.set(
				semesterLabel,
				bounds
					? [Math.min(bounds[0], projectionPageStart), Math.max(bounds[1], projectionPageEnd)]
					: [projectionPageStart, projectionPageEnd],
			);
		}
	}
	return [...courseTitlesBySemester.entries()]
		.sort(
			([left], [right]) =>
				Number(SEMESTER_LABEL_TO_INDEX[left as keyof typeof SEMESTER_LABEL_TO_INDEX] ?? 999) -
				Number(SEMESTER_LABEL_TO_INDEX[right as keyof typeof SEMESTER_LABEL_TO_INDEX] ?? 999),
		)
		.map(([semesterLabel, courseTitles]) => {
			const bounds = pageBoundsBySemester.get(semesterLabel) ?? [
				input.sourceDocument.page_start,
				input.sourceDocument.page_end,
			];
			return {
				courseTitles,
				pageEnd: bounds[1],
				pageStart: bounds[0],
				semesterLabel,
				sourceDocument: input.sourceDocument,
			};
		});
}

function extractSemesterCourseTitles(
	tableRows: readonly (readonly string[])[],
): Map<string, string[]> {
	const results = new Map<string, string[]>();
	let layout: CurriculumSemesterTableLayout | null = null;
	let courseNameIndex = -1;
	for (const cells of tableRows) {
		if (cells.includes("课程名称")) {
			courseNameIndex = cells.indexOf("课程名称");
		}
		const resolvedLayout = resolveCurriculumSemesterTableLayout(cells);
		if (resolvedLayout) {
			layout = resolvedLayout;
			continue;
		}
		if (courseNameIndex < 0 || courseNameIndex >= cells.length) {
			continue;
		}
		const courseTitle = normalizeText(cells[courseNameIndex]);
		if (!courseTitle || courseTitle === "课程名称") {
			continue;
		}
		for (const semesterLabel of extractRowSemesterLabels(cells, layout)) {
			const titles = results.get(semesterLabel) ?? [];
			if (!titles.includes(courseTitle)) {
				titles.push(courseTitle);
			}
			results.set(semesterLabel, titles);
		}
	}
	return results;
}

function resolveCurriculumSemesterTableLayout(
	cells: readonly string[],
): CurriculumSemesterTableLayout | null {
	if (!cells.includes("课程名称")) {
		return null;
	}
	for (const [index, cell] of cells.entries()) {
		if (cell === "开设学期" || cell === "修读学期") {
			return { distributionSemesterIndexes: [], singleSemesterIndex: index };
		}
	}
	const distributionSemesterIndexes = cells
		.map((cell, index) => [SEMESTER_INDEX_TO_LABEL[cell], index] as [string | undefined, number])
		.filter((item): item is [string, number] => Boolean(item[0]));
	return distributionSemesterIndexes.length >= 2
		? { distributionSemesterIndexes, singleSemesterIndex: -1 }
		: null;
}

function extractRowSemesterLabels(
	cells: readonly string[],
	layout: CurriculumSemesterTableLayout | null,
): string[] {
	if (layout?.singleSemesterIndex !== undefined && layout.singleSemesterIndex >= 0) {
		return extractSemesterLabelsFromCell(cells[layout.singleSemesterIndex] ?? "");
	}
	const distributionSemesterIndexes = layout?.distributionSemesterIndexes ?? [];
	if (distributionSemesterIndexes.length > 0) {
		return distributionSemesterIndexes
			.filter(([, columnIndex]) => cellHasValue(cells[columnIndex] ?? ""))
			.map(([semesterLabel]) => semesterLabel);
	}
	return extractSemesterLabelsFromCell(cells.at(-1) ?? "");
}

function extractSemesterLabelsFromCell(value: string): string[] {
	const normalized = normalizeText(value);
	if (!(normalized && cellHasValue(normalized))) {
		return [];
	}
	const results: string[] = [];
	for (const match of normalized.matchAll(/(?<!\d)(\d+)\s*-\s*(\d+)(?!\d)/gu)) {
		for (let index = Number(match[1]); index <= Number(match[2]); index += 1) {
			const label = SEMESTER_INDEX_TO_LABEL[String(index)];
			if (label && !results.includes(label)) {
				results.push(label);
			}
		}
	}
	for (const match of normalized.matchAll(/\d+/gu)) {
		const label = SEMESTER_INDEX_TO_LABEL[match[0]];
		if (label && !results.includes(label)) {
			results.push(label);
		}
	}
	for (const label of Object.keys(SEMESTER_LABEL_TO_INDEX)) {
		if (normalized.includes(label) && !results.includes(label)) {
			results.push(label);
		}
	}
	return results;
}

function programSemesterDocumentUnit(input: {
	documentId: string;
	projection: ProgramSemesterProjection;
	sourcePdf: string;
	versionId: string;
}): Record<string, unknown> {
	const sourceUrl =
		"campus-agent://rag-data/canonical/curriculum_plan/program-semester/" +
		`${input.projection.sourceDocument.title}/${input.projection.semesterLabel}.md`;
	return {
		doc_id: input.documentId,
		version_id: input.versionId,
		chunk_id: `${input.documentId}:row-0001`,
		clean_text: programSemesterSnippet(input.projection),
		source_pdf: input.sourcePdf,
		source_url: sourceUrl,
		source: { id: sourceUrl },
		page_start: input.projection.pageStart,
		page_end: input.projection.pageEnd,
		...authorizationRow(input.projection.sourceDocument),
		anchor: {
			fact_type: "semester_course_list",
			section_path: [input.projection.sourceDocument.title, input.projection.semesterLabel],
			detail_label: `${input.projection.semesterLabel}课程`,
		},
		unit_type: "program_semester_fact",
		root_unit_id: `${input.documentId}:root`,
		metadata: {
			source_title: programSemesterProjectionTitle(input.projection),
			content_kind: "program_semester_fact",
			content_role: "semester_course_list",
			detail_label: `${input.projection.semesterLabel}课程`,
			is_answer_bearing: true,
			source_doc_id: input.projection.sourceDocument.document_id,
			source_doc_title: input.projection.sourceDocument.title,
			semester_label: input.projection.semesterLabel,
			semester_index:
				SEMESTER_LABEL_TO_INDEX[
					input.projection.semesterLabel as keyof typeof SEMESTER_LABEL_TO_INDEX
				],
			course_titles: input.projection.courseTitles,
		},
	};
}

function programSemesterProjectionTitle(projection: ProgramSemesterProjection): string {
	return `${projection.sourceDocument.title} ${projection.semesterLabel}课程事实`;
}

function programSemesterSnippet(projection: ProgramSemesterProjection): string {
	return `按当前已采集的《${projection.sourceDocument.title}》，${projection.semesterLabel}有${projection.courseTitles.join("、")}。`;
}
