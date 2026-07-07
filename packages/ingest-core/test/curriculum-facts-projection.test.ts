import { describe, expect, it } from "vitest";
import {
	buildCurriculumCourseFactsDocuments,
	buildCurriculumProgramFamilyFactsDocuments,
	buildCurriculumProgramSemesterFactDocumentId,
	buildCurriculumProgramSemesterFactsDocuments,
	type CurriculumProgramFamilyConfig,
	type CurriculumRawAssetRecord,
	type CurriculumSplitManifestDocument,
} from "../src/index.ts";

const rawAssetRecord: CurriculumRawAssetRecord = {
	raw_asset_id: "asset:curriculum-plan-master-pdf",
	raw_version_id: "sha256:program-facts-001",
	raw_source_uri: "campus-agent://source/curriculum/curriculum-plan.pdf",
	object_key: "official_pdf/curriculum-plan-master/provider-response.jsonl",
};

describe("curriculum facts projection", () => {
	it("builds course-family fact documents from structured curriculum rows", () => {
		const documents = buildCurriculumCourseFactsDocuments({
			layoutElementsKey: "derived/curriculum/layout-elements.jsonl",
			providerResponseKey: "derived/curriculum/provider-response.jsonl",
			rawAssetRecord,
			sourcePdf: "synthetic-curriculum-plan-2026.pdf",
			splitManifestDocuments: [
				{
					document_id: "curriculum:示例大学通识课程思想政治理论课教学计划",
					title: "示例大学通识课程思想政治理论课教学计划",
					page_start: 22,
					page_end: 36,
					status: "active",
				},
			],
			structuredRows: [
				row(
					"学校除开设马克思主义基本原理、中国近现代史纲要、毛泽东思想和中国特色社会主义理论体系概论、习近平新时代中国特色社会主义思想概论、思想道德与法治、形势与政策等6门思政课外，还开设一门特色思政课“中华民族共同体概论”。",
				),
				row(
					"思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
				),
				row("2. 历史学专业不开设“中国近现代史纲要”课程。"),
				row(
					"<table><tr><td>课程名称</td><td>学分</td><td>学时</td><td>理论/实践学时</td><td>开设学期</td></tr><tr><td>马克思主义基本原理</td><td>3</td><td>54</td><td>36</td><td>第3学期(文科)</td></tr><tr><td>形势与政策</td><td>2</td><td>64</td><td>46</td><td>1-8学期</td></tr></table>",
				),
			],
		});

		const familyDocument = documents.find(
			(document) => document.title === "思想政治理论课课程事实",
		);

		expect(familyDocument).toBeDefined();
		expect(familyDocument).toMatchObject({
			collection: "course_facts",
			corpus: "curriculum",
			source_channel: "pdf_ocr",
			year: "2026",
		});
		expect(documentUnit(familyDocument)).toMatchObject({
			doc_id: "course_facts:family-membership",
			metadata: {
				canonical_course_family_id: "course_family:muc.ideological_political_theory",
				family_aliases: ["思政课", "思修课", "思政", "思政课程"],
				content_role: "family_membership",
			},
		});

		const semesterDocument = documents.find(
			(document) =>
				documentUnit(document).doc_id === "course_facts:muc.marxist_basic_principles-semester",
		);
		expect(documentUnit(semesterDocument)).toMatchObject({
			clean_text: "马克思主义基本原理开设学期：第3学期(文科)。",
			metadata: {
				canonical_course_id: "course:muc.marxist_basic_principles",
				canonical_course_title: "马克思主义基本原理",
			},
		});
	});

	it("builds program-family fact documents from injected governance config", () => {
		const documents = buildCurriculumProgramFamilyFactsDocuments({
			familyConfig: programFamilyConfig,
			rawAssetRecord,
			sourcePdf: "curriculum-plan.pdf",
			splitManifestDocuments: [
				splitDocument(
					"curriculum:synthetic-public-affairs-plan",
					"Synthetic public affairs curriculum plan",
					1,
					3,
				),
				{
					...splitDocument(
						"curriculum:synthetic-data-systems-plan",
						"Synthetic data systems curriculum plan",
						4,
						6,
					),
					entitlement_groups: ["campus_members"],
					visibility_scope: "campus",
				},
			],
		});

		expect(documents.map((document) => document.title)).toEqual([
			"Synthetic cross-campus program family",
			"Synthetic public program family",
		]);
		expect(documentUnit(documents[0])).toMatchObject({
			doc_id: "program_family_facts:synthetic.cross_campus_programs:membership",
			clean_text: "Synthetic cross-campus programs include public affairs and data systems.",
			metadata: {
				canonical_program_family_id: "program_family:synthetic.cross_campus_programs",
				content_role: "family_membership",
				member_program_titles: [
					"Synthetic public affairs curriculum plan",
					"Synthetic data systems curriculum plan",
				],
			},
		});
	});

	it("builds program-semester fact documents from pipe and sparse table rows", () => {
		const documents = buildCurriculumProgramSemesterFactsDocuments({
			layoutElementsKey: "derived/curriculum/layout-elements.jsonl",
			providerResponseKey: "derived/curriculum/provider-response.jsonl",
			rawAssetRecord,
			sourcePdf: "curriculum-plan.pdf",
			splitManifestDocuments: [
				splitDocument(
					"curriculum:法学（民族实验班）本科人才培养方案",
					"法学（民族实验班）本科人才培养方案",
					1,
					2,
				),
				splitDocument(
					"curriculum:历史学（强基计划）本科人才培养方案",
					"历史学（强基计划）本科人才培养方案",
					90,
					96,
				),
			],
			structuredRows: [
				{
					clean_text:
						"专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4",
					page_start: 2,
					page_end: 2,
				},
				{
					clean_text: "八、历史学本科专业教学进程计划表（表格见结构化 cells）",
					page_start: 93,
					page_end: 93,
					table_cells: [
						tableCell(1, 1, "类别"),
						tableCell(1, 2, "课程号"),
						tableCell(1, 3, "课程名称"),
						tableCell(1, 4, "学分"),
						tableCell(1, 5, "学时"),
						tableCell(1, 6, "实践学时"),
						tableCell(1, 7, "修读学期"),
						tableCell(2, 1, "培养课", 2),
						tableCell(2, 2, "1042010081"),
						tableCell(2, 3, "大学英语(三)"),
						tableCell(2, 4, "2"),
						tableCell(2, 5, "54"),
						tableCell(2, 6, "36"),
						tableCell(2, 7, "3"),
						tableCell(3, 2, "1042010082"),
						tableCell(3, 3, "大学英语(四)"),
						tableCell(3, 4, "2"),
						tableCell(3, 5, "54"),
						tableCell(3, 6, "36"),
						tableCell(3, 7, "4"),
					],
				},
			],
		});

		const lawFourth = documents.find(
			(document) =>
				documentUnit(document).doc_id ===
				buildCurriculumProgramSemesterFactDocumentId(
					"curriculum:法学（民族实验班）本科人才培养方案",
					"第四学期",
				),
		);
		expect(documentUnit(lawFourth)).toMatchObject({
			clean_text:
				"按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有侵权责任法、公司法。",
			metadata: {
				course_titles: ["侵权责任法", "公司法"],
				semester_index: "4",
				semester_label: "第四学期",
			},
		});

		const historyFourth = documents.find(
			(document) =>
				documentUnit(document).doc_id ===
				buildCurriculumProgramSemesterFactDocumentId(
					"curriculum:历史学（强基计划）本科人才培养方案",
					"第四学期",
				),
		);
		expect(documentUnit(historyFourth)).toMatchObject({
			metadata: {
				course_titles: ["大学英语(四)"],
			},
		});
	});
});

function row(cleanText: string): Record<string, unknown> {
	return { clean_text: cleanText };
}

function splitDocument(
	documentId: string,
	title: string,
	pageStart: number,
	pageEnd: number,
): CurriculumSplitManifestDocument {
	return {
		document_id: documentId,
		page_end: pageEnd,
		page_start: pageStart,
		status: "active",
		title,
	};
}

function tableCell(
	rowIndex: number,
	colIndex: number,
	text: string,
	rowspan = 1,
	colspan = 1,
): Record<string, unknown> {
	return {
		col: colIndex,
		colspan,
		row: rowIndex,
		rowspan,
		text,
	};
}

function documentUnit(document: unknown): Record<string, unknown> {
	if (!document) {
		throw new Error("expected curriculum projection document");
	}
	const documentUnitsJsonl = (document as { document_units_jsonl: string }).document_units_jsonl;
	return JSON.parse(documentUnitsJsonl.trim()) as Record<string, unknown>;
}

const programFamilyConfig: CurriculumProgramFamilyConfig = {
	families: [
		{
			answer_snippet: "Synthetic cross-campus programs include public affairs and data systems.",
			canonical_program_family_id: "program_family:synthetic.cross_campus_programs",
			canonical_program_family_title: "Synthetic cross-campus programs",
			match_aliases: ["cross-campus programs", "interdisciplinary programs"],
			member_program_ids: [
				"curriculum:synthetic-public-affairs-plan",
				"curriculum:synthetic-data-systems-plan",
			],
			member_program_titles: [
				"Synthetic public affairs curriculum plan",
				"Synthetic data systems curriculum plan",
			],
			mode: "direct_answer_family",
			source_title: "Synthetic cross-campus program family",
		},
		{
			answer_snippet: "Synthetic public programs include the public affairs curriculum plan.",
			canonical_program_family_id: "program_family:synthetic.public_only_programs",
			canonical_program_family_title: "Synthetic public programs",
			match_aliases: ["public programs"],
			member_program_ids: ["curriculum:synthetic-public-affairs-plan"],
			member_program_titles: ["Synthetic public affairs curriculum plan"],
			mode: "direct_answer_family",
			source_title: "Synthetic public program family",
		},
	],
};
