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
							"/docs/curriculum/curriculum_plan/computer-science/v/2026#graduation-requirements",
						section_title: "二、毕业要求",
						snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
						title: "计算机类本科人才培养方案",
						version_id: "version-computer-science-2026",
						version_slug: "2026",
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
							href: "/docs/curriculum/curriculum_plan/computer-science/v/2026?hl=curriculum-root-001%2Ccurriculum-root-002#graduation-requirements",
							label: "查看文档",
						},
						sectionTitle: "二、毕业要求",
						snippet: "学生应完成通识教育、专业教育和实践教学等模块。",
						title: "计算机类本科人才培养方案",
						versionSlug: "2026",
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
							href: "/docs/regulations/student_rules/student-handbook/v/2026#network-use",
							label: "打开网页",
						},
						sectionTitle: "校园网络使用",
						snippet: "学生应遵守校园网络使用规定。",
						title: "学生手册",
						versionSlug: "2026",
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
						section_ref: "/docs/regulations/student_rules/handbook/v/2026#rules",
						section_title: "管理规定",
						title: "学生手册",
						version_slug: "2026",
					},
					{
						citation_index: 1,
						kind: "campus_document",
						root_unit_ids: ["root-1"],
						section_ref: "/docs/regulations/student_rules/handbook/v/2026#rules",
						section_title: "管理规定",
						title: "学生手册",
						version_slug: "2026",
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
						href: "/docs/regulations/student_rules/handbook/v/2026?hl=root-4%2Croot-1#rules",
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
						section_ref: `/docs/regulations/student_rules/handbook/v/2026#rules-${citationIndex}`,
						section_title: `管理规定 ${citationIndex}`,
						title: `学生手册 ${citationIndex}`,
						version_slug: "2026",
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

	it("projects Web sources with citation hrefs and preserves URL identity", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				sources: [
					{
						citation_href: "https://www.muc.edu.cn/contact?campus=main#mailing-address",
						citation_index: 1,
						hostname: "www.muc.edu.cn",
						kind: "web_page",
						title: "联系我们",
						url: "https://www.muc.edu.cn/contact?campus=main",
					},
					{
						citation_href: "https://www.muc.edu.cn/contact?campus=fengtai#address",
						citation_index: 2,
						hostname: "www.muc.edu.cn",
						kind: "web_page",
						title: "联系我们",
						url: "https://www.muc.edu.cn/contact?campus=fengtai#address",
					},
					{
						citation_href: "https://www.muc.edu.cn/contact?campus=main#address",
						citation_index: 7,
						hostname: "www.muc.edu.cn",
						kind: "web_page",
						title: "学校联系方式",
						url: "https://www.muc.edu.cn/contact?campus=main",
					},
				],
			},
			status: "completed",
		});

		expect(parts).toEqual([
			{
				sourceItems: [
					{
						citationIndexes: [1, 7],
						hostname: "www.muc.edu.cn",
						kind: "web_page",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://www.muc.edu.cn/contact?campus=main#mailing-address",
							label: "打开网页",
						},
						snippet: null,
						title: "联系我们",
					},
					{
						citationIndexes: [2],
						hostname: "www.muc.edu.cn",
						kind: "web_page",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://www.muc.edu.cn/contact?campus=fengtai#address",
							label: "打开网页",
						},
						snippet: null,
						title: "联系我们",
					},
				],
				type: "source_items",
			},
		]);
	});

	it.each([
		[
			"unsupported protocol",
			{
				citation_href: "ftp://www.muc.edu.cn/contact",
				citation_index: 1,
				hostname: "www.muc.edu.cn",
				kind: "web_page",
				title: "联系我们",
				url: "ftp://www.muc.edu.cn/contact",
			},
		],
		[
			"URL credentials",
			{
				citation_href: "https://user:password@www.muc.edu.cn/contact",
				citation_index: 1,
				hostname: "www.muc.edu.cn",
				kind: "web_page",
				title: "联系我们",
				url: "https://user:password@www.muc.edu.cn/contact",
			},
		],
		[
			"hostname mismatch",
			{
				citation_href: "https://www.muc.edu.cn/contact",
				citation_index: 1,
				hostname: "evil.example",
				kind: "web_page",
				title: "联系我们",
				url: "https://www.muc.edu.cn/contact",
			},
		],
	] as const)("rejects Web source with %s", (_name, source) => {
		expect(() =>
			normalizeSourceItemsPart({ result: { sources: [source] }, status: "completed" }),
		).toThrow("Execution source item 0 is invalid.");
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
							section_ref: "/docs/regulations/student_rules/handbook/v/2026#rules",
							title: "学生手册",
							version_slug: "2026",
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
								href: "/docs/regulations/student_rules/handbook/v/2026#rules",
								label: "查看文档",
							},
							title: "学生手册",
							versionSlug: "2026",
						},
					],
					type: "source_items",
				},
			]),
		).toEqual([]);
	});
});
