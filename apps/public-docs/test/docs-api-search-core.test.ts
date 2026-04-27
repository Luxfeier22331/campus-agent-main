import { describe, expect, it } from "vitest";

import {
	collectDocsSearchScopes,
	mapDocsApiResultsToSuggestions,
} from "../src/search/docs-api-search-core";

describe("public docs API search helpers", () => {
	it("collects unique docs scopes from Rspress search index pages", () => {
		expect(
			collectDocsSearchScopes([
				{
					content: "课程",
					routePath: "/docs/curriculum/curriculum_plan/law",
					title: "法学本科人才培养方案",
					toc: [],
				},
				{
					content: "学生手册",
					routePath: "/docs/regulations/student_rules/student-attendance-management",
					title: "中央民族大学学生考勤管理办法",
					toc: [],
				},
				{
					content: "历史版本显式路由",
					routePath: "/docs/curriculum/curriculum_plan/law/v/2025-history",
					title: "法学本科人才培养方案",
					toc: [],
				},
				{
					content: "首页",
					routePath: "/docs/",
					title: "公开文档总览",
					toc: [],
				},
			]),
		).toEqual([
			{ collection: "curriculum_plan", corpus: "curriculum" },
			{ collection: "student_rules", corpus: "regulations" },
		]);
	});

	it("maps docs API section hits to Rspress search suggestions", () => {
		expect(
			mapDocsApiResultsToSuggestions("第四学期", [
				{
					response: {
						query: "第四学期",
						results: [
							{
								anchor: "semester-4",
								canonicalUrl:
									"/docs/curriculum/curriculum_plan/law?hl=semester-4-course-list#semester-4",
								documentTitle: "法学本科人才培养方案",
								highlightRootUnitIds: ["semester-4-course-list"],
								kind: "section_hit",
								snippet: "第四学期开设法理学、宪法学。",
								title: "第四学期",
							},
						],
					},
					scope: { collection: "curriculum_plan", corpus: "curriculum" },
				},
			]),
		).toEqual([
			{
				header: "法学本科人才培养方案 > 第四学期",
				highlightInfoList: [{ length: 12, start: 0 }],
				link: "/docs/curriculum/curriculum_plan/law?hl=semester-4-course-list#semester-4",
				query: "第四学期",
				statement: "第四学期开设法理学、宪法学。",
				title: "法学本科人才培养方案",
				type: "content",
			},
		]);
	});
});
