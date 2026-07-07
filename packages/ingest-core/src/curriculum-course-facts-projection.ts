import {
	authorizationRow,
	buildDigestVersionId,
	type CurriculumProjectionDocument,
	type CurriculumRawAssetRecord,
	type CurriculumSplitManifestDocument,
	ensureFinalPeriod,
	extractTableRows,
	inferYear,
	normalizeText,
	PDF_OCR_SOURCE_CHANNEL,
	projectionDocument,
	resolvedVisibilityScope,
	rowText,
	sourceStatus,
	stripFinalPeriod,
	unique,
} from "./curriculum-facts-shared.ts";

const COURSE_FAMILY_ID = "course_family:muc.ideological_political_theory";
const COURSE_FAMILY_TITLE = "思想政治理论课";
const COURSE_SOURCE_TITLE = "示例大学通识课程思想政治理论课教学计划";
const COURSE_SOURCE_DOCUMENT_ID = "curriculum:示例大学通识课程思想政治理论课教学计划";
const COURSE_FAMILY_ALIASES = ["思政课", "思修课", "思政", "思政课程"] as const;

const CANONICAL_COURSES = [
	["course:muc.marxist_basic_principles", "马克思主义基本原理"],
	["course:muc.modern_chinese_history_outline", "中国近现代史纲要"],
	[
		"course:muc.mao_zedong_thought_and_theoretical_system",
		"毛泽东思想和中国特色社会主义理论体系概论",
	],
	["course:muc.xigai", "习近平新时代中国特色社会主义思想概论"],
	["course:muc.ideological_morality_and_rule_of_law", "思想道德与法治"],
	["course:muc.situation_and_policy", "形势与政策"],
	["course:muc.community_for_chinese_nation", "中华民族共同体概论"],
] as const;

interface CourseFactProjection {
	factId: string;
	factType: string;
	snippet: string;
	detailLabel: string;
	contentRole: string;
	sectionPath: readonly string[];
	canonicalCourseId?: string;
	canonicalCourseTitle?: string;
}

export function buildCurriculumCourseFactsDocuments(input: {
	layoutElementsKey: string;
	providerResponseKey: string;
	rawAssetRecord: CurriculumRawAssetRecord;
	sourcePdf: string;
	splitManifestDocuments: readonly CurriculumSplitManifestDocument[];
	structuredRows: readonly Record<string, unknown>[];
	importSource?: string;
}): CurriculumProjectionDocument[] {
	const sourceDocument = input.splitManifestDocuments.find(
		(document) => document.document_id === COURSE_SOURCE_DOCUMENT_ID,
	);
	if (!sourceDocument) {
		return [];
	}
	const projections = buildCourseFactProjections(input.structuredRows);
	const year = inferYear(input.sourcePdf);
	return projections.map((projection) => {
		const documentId = `course_facts:${projection.factId}`;
		const versionId = buildDigestVersionId(
			`${input.rawAssetRecord.raw_version_id}|${projection.factId}`,
			`${input.rawAssetRecord.raw_version_id}:course-facts:${projection.factId}`,
		);
		const row = courseFactDocumentUnit({
			documentId,
			projection,
			sourceDocument,
			sourcePdf: input.sourcePdf,
			versionId,
		});
		return projectionDocument({
			additionalProcessedObjectKeys: [input.layoutElementsKey],
			collection: "course_facts",
			corpus: "curriculum",
			importSource: input.importSource ?? "provider_response_replay",
			providerResponseObjectKey: input.providerResponseKey,
			rawAssetRecord: input.rawAssetRecord,
			row,
			sourceChannel: PDF_OCR_SOURCE_CHANNEL,
			sourceLabel: `${input.providerResponseKey}#${documentId}`,
			status: sourceStatus(sourceDocument),
			title: courseProjectionTitle(projection),
			visibilityScope: resolvedVisibilityScope(sourceDocument),
			year,
		});
	});
}

function buildCourseFactProjections(
	structuredRows: readonly Record<string, unknown>[],
): CourseFactProjection[] {
	const familyMembers = extractFamilyMemberTitles(structuredRows);
	const audienceSnippet = extractAudienceSnippet(structuredRows);
	const courseSemesters = extractCourseSemesters(structuredRows);
	const exceptions = extractExceptionSnippets(structuredRows);
	const projections: CourseFactProjection[] = [
		{
			contentRole: "family_membership",
			detailLabel: "课程内容",
			factId: "family-membership",
			factType: "family_membership",
			sectionPath: [COURSE_FAMILY_TITLE],
			snippet: `${COURSE_FAMILY_TITLE}包括${familyMembers.join("、")}。`,
		},
	];
	if (audienceSnippet) {
		projections.push({
			contentRole: "audience",
			detailLabel: "修读要求",
			factId: "family-audience",
			factType: "audience",
			sectionPath: [COURSE_FAMILY_TITLE],
			snippet: audienceSnippet,
		});
	}
	for (const [canonicalCourseId, canonicalCourseTitle] of CANONICAL_COURSES) {
		const semesterLines = courseSemesters.get(canonicalCourseTitle) ?? [];
		if (semesterLines.length > 0) {
			projections.push({
				canonicalCourseId,
				canonicalCourseTitle,
				contentRole: "semester",
				detailLabel: "开设学期",
				factId: factId(canonicalCourseId, "semester"),
				factType: "semester",
				sectionPath: [COURSE_FAMILY_TITLE, canonicalCourseTitle],
				snippet: `${canonicalCourseTitle}开设学期：${semesterLines.join("；")}。`,
			});
		}
		if (audienceSnippet) {
			const exception = exceptions.get(canonicalCourseTitle);
			const courseAudience = [stripFinalPeriod(audienceSnippet), stripFinalPeriod(exception ?? "")]
				.filter(Boolean)
				.join("。");
			projections.push({
				canonicalCourseId,
				canonicalCourseTitle,
				contentRole: "audience",
				detailLabel: "修读要求",
				factId: factId(canonicalCourseId, "audience"),
				factType: "audience",
				sectionPath: [COURSE_FAMILY_TITLE, canonicalCourseTitle],
				snippet: `${courseAudience}。`,
			});
		}
	}
	return projections;
}

function courseFactDocumentUnit(input: {
	documentId: string;
	projection: CourseFactProjection;
	sourceDocument: CurriculumSplitManifestDocument;
	sourcePdf: string;
	versionId: string;
}): Record<string, unknown> {
	const sourceUrl = `campus-agent://rag-data/canonical/curriculum_plan/docs/${COURSE_SOURCE_TITLE}.md`;
	return {
		doc_id: input.documentId,
		version_id: input.versionId,
		chunk_id: `${input.documentId}:row-0001`,
		clean_text: input.projection.snippet,
		source_pdf: input.sourcePdf,
		source_url: sourceUrl,
		source: { id: sourceUrl },
		page_start: 22,
		page_end: 26,
		...authorizationRow(input.sourceDocument),
		anchor: {
			fact_type: input.projection.factType,
			section_path: input.projection.sectionPath,
			detail_label: input.projection.detailLabel,
		},
		unit_type: "course_fact",
		root_unit_id: `${input.documentId}:root`,
		metadata: {
			source_title: COURSE_SOURCE_TITLE,
			content_kind: "course_fact",
			content_role: input.projection.contentRole,
			detail_label: input.projection.detailLabel,
			is_answer_bearing: true,
			canonical_course_family_id: COURSE_FAMILY_ID,
			canonical_course_family_title: COURSE_FAMILY_TITLE,
			family_aliases: [...COURSE_FAMILY_ALIASES],
			...(input.projection.canonicalCourseId && input.projection.canonicalCourseTitle
				? {
						canonical_course_id: input.projection.canonicalCourseId,
						canonical_course_title: input.projection.canonicalCourseTitle,
					}
				: {}),
		},
	};
}

function extractFamilyMemberTitles(rows: readonly Record<string, unknown>[]): string[] {
	const fullText = rows.map((row) => normalizeText(rowText(row))).join(" ");
	if (fullText.includes("学校除开设") && fullText.includes("等6门思政课外")) {
		const segment = fullText.split("学校除开设", 2)[1]?.split("等6门思政课外", 1)[0] ?? "";
		const titles = CANONICAL_COURSES.map(([, title]) => title).filter((title) =>
			segment.includes(title),
		);
		if (titles.length > 0) {
			return unique([...titles, "中华民族共同体概论"]);
		}
	}
	return CANONICAL_COURSES.map(([, title]) => title);
}

function extractAudienceSnippet(rows: readonly Record<string, unknown>[]): string {
	for (const row of rows) {
		const text = normalizeText(rowText(row));
		if (
			text.includes("所有本预科学生") &&
			(text.includes("公共必修课") || text.includes("修读要求"))
		) {
			return ensureFinalPeriod(text);
		}
	}
	return "";
}

function extractCourseSemesters(rows: readonly Record<string, unknown>[]): Map<string, string[]> {
	const results = new Map<string, string[]>();
	for (const row of rows) {
		if (!(rowText(row).includes("课程名称") && rowText(row).includes("开设学期"))) {
			continue;
		}
		const tableRows = extractTableRows(row);
		let courseNameIndex = -1;
		let semesterIndex = -1;
		for (const cells of tableRows) {
			if (cells.includes("课程名称")) {
				courseNameIndex = cells.indexOf("课程名称");
				semesterIndex = cells.findIndex((cell) => cell === "开设学期" || cell === "修读学期");
				continue;
			}
			if (courseNameIndex < 0 || semesterIndex < 0) {
				continue;
			}
			const title = normalizeText(cells[courseNameIndex] ?? "");
			const semesterText = normalizeText(cells[semesterIndex] ?? "");
			if (title && semesterText) {
				results.set(title, splitSemesterLines(semesterText));
			}
		}
	}
	return results;
}

function extractExceptionSnippets(rows: readonly Record<string, unknown>[]): Map<string, string> {
	const results = new Map<string, string>();
	for (const row of rows) {
		const text = normalizeText(rowText(row));
		if (!text.includes("不开设")) {
			continue;
		}
		for (const [, title] of CANONICAL_COURSES) {
			if (text.includes(title)) {
				results.set(title, ensureFinalPeriod(text));
			}
		}
	}
	return results;
}

function courseProjectionTitle(projection: CourseFactProjection): string {
	return projection.canonicalCourseTitle
		? `${projection.canonicalCourseTitle}课程事实`
		: `${COURSE_FAMILY_TITLE}课程事实`;
}

function splitSemesterLines(value: string): string[] {
	return unique(
		value
			.split(/(?=第[0-9一二三四五六七八九十]+学期)|；|;/u)
			.map(normalizeText)
			.filter(Boolean),
	);
}

function factId(canonicalCourseId: string, factType: string): string {
	return `${canonicalCourseId.split(":").slice(1).join(":")}-${factType}`;
}
