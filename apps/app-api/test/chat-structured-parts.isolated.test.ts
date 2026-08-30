// @vitest-environment node

import { describe, expect, it } from "vitest";

import { normalizeChatStructuredParts } from "../src/modules/chat";
import { normalizeSourceItemsPart } from "../src/modules/runtime-command/service/normalize";

describe("chat structured parts", () => {
	it("projects a document source result into browser source items", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				sources: [
					{
						citation_index: 1,
						document_id: "curriculum_plan/computer-science",
						kind: "campus_document",
						root_unit_ids: ["curriculum-root-001", "curriculum-root-002"],
						section_ref:
							"/docs/curriculum/curriculum_plan/computer-science/v/2026-current#graduation-requirements",
						section_title: "二、毕业要求",
						snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
						title: "计算机类本科人才培养方案",
						version_id: "version-computer-science-2026",
						version_label: "2026 版",
						version_slug: "2026-current",
					},
				],
			},
			status: "completed",
		});

		expect(parts).toEqual([
			{
				sourceItems: [
					{
						citationIndexes: [1],
						collectionLabel: "培养方案",
						kind: "campus_document",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/curriculum/curriculum_plan/computer-science/v/2026-current?hl=curriculum-root-001%2Ccurriculum-root-002#graduation-requirements",
							label: "查看文档",
						},
						sectionTitle: "二、毕业要求",
						snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
						title: "计算机类本科人才培养方案",
						versionLabel: "2026 版",
					},
				],
				type: "source_items",
			},
		]);
	});

	it("drops persisted source items that do not use the current source contract", () => {
		const parts = normalizeChatStructuredParts([
			{
				sourceItems: [
					{
						citationIndexes: [1],
						legacyRouting: "ignored",
						primaryAction: {
							external: true,
							href: "/docs/regulations/student_rules/student-handbook/v/2026-current#network-use",
							label: "打开网页",
						},
						sectionTitle: "校园网络使用",
						snippet: "学生应遵守校园网络使用规定。",
						title: "学生手册",
						versionLabel: "2026 版",
					},
				],
				type: "source_items",
			},
		]);

		expect(parts).toEqual([]);
	});

	it("drops non-document and malformed source references", () => {
		expect(() =>
			normalizeSourceItemsPart({
				result: {
					sources: [
						{
							kind: "campus_document",
							section_ref: "https://muc.edu.cn/news/1#details",
							title: "公开网页",
						},
					],
				},
				status: "completed",
			}),
		).toThrow("Execution source item 0 is invalid.");
		const persistedParts = normalizeChatStructuredParts([
			{
				sourceItems: [
					{
						primaryAction: { href: "https://muc.edu.cn/news/1", label: "打开网页" },
						title: "公开网页",
					},
				],
				type: "source_items",
			},
		]);

		expect(persistedParts).toEqual([]);
	});

	it("preserves citation order and merges duplicate source cards", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				sources: [
					{
						citation_index: 4,
						kind: "campus_document",
						root_unit_ids: ["root-4"],
						section_ref: "/docs/regulations/student_rules/handbook/v/2026-current#rules",
						section_title: "管理规定",
						title: "学生手册",
						version_label: "2026 版",
						version_slug: "2026-current",
					},
					{
						citation_index: 1,
						kind: "campus_document",
						root_unit_ids: ["root-1"],
						section_ref: "/docs/regulations/student_rules/handbook/v/2026-current#rules",
						section_title: "管理规定",
						title: "学生手册",
						version_label: "2026 版",
						version_slug: "2026-current",
					},
				],
			},
			status: "completed",
		});

		expect(parts[0]).toMatchObject({
			sourceItems: [
				{
					citationIndexes: [4, 1],
					primaryAction: {
						href: "/docs/regulations/student_rules/handbook/v/2026-current?hl=root-4%2Croot-1#rules",
					},
				},
			],
		});
	});

	it("keeps citation ten and more than five cited source cards", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				sources: Array.from({ length: 6 }, (_, offset) => {
					const citationIndex = offset + 5;
					return {
						citation_index: citationIndex,
						kind: "campus_document",
						root_unit_ids: [`root-${citationIndex}`],
						section_ref: `/docs/regulations/student_rules/handbook/v/2026-current#rules-${citationIndex}`,
						section_title: `管理规定 ${citationIndex}`,
						title: `学生手册 ${citationIndex}`,
						version_label: "2026 版",
						version_slug: "2026-current",
					};
				}),
			},
			status: "completed",
		});

		expect(parts[0]).toMatchObject({
			sourceItems: [
				{ citationIndexes: [5] },
				{ citationIndexes: [6] },
				{ citationIndexes: [7] },
				{ citationIndexes: [8] },
				{ citationIndexes: [9] },
				{ citationIndexes: [10] },
			],
		});
	});

	it.each([
		["missing", undefined],
		["zero", 0],
		["eleven", 11],
		["fraction", 1.5],
	] as const)("rejects invalid citation index: %s", (_name, citationIndex) => {
		expect(() =>
			normalizeSourceItemsPart({
				result: {
					sources: [
						{
							...(citationIndex === undefined ? {} : { citation_index: citationIndex }),
							kind: "campus_document",
							section_ref: "/docs/regulations/student_rules/handbook/v/2026-current#rules",
							title: "学生手册",
							version_label: "2026 版",
							version_slug: "2026-current",
						},
					],
				},
				status: "completed",
			}),
		).toThrow("Execution source item 0 is invalid.");
	});

	it("drops persisted source cards with duplicate citation indexes", () => {
		expect(
			normalizeChatStructuredParts([
				{
					sourceItems: [
						{
							citationIndexes: [1, 1],
							kind: "campus_document",
							primaryAction: {
								external: false,
								href: "/docs/regulations/student_rules/handbook/v/2026-current#rules",
								label: "查看文档",
							},
							title: "学生手册",
							versionLabel: "2026 版",
						},
					],
					type: "source_items",
				},
			]),
		).toEqual([]);
	});
});
