// @vitest-environment node

import { describe, expect, it } from "vitest";

import { normalizeChatStructuredParts } from "../src/modules/chat";
import { normalizeSourceItemsPart } from "../src/modules/runtime-command/service/normalize";

describe("chat structured parts", () => {
	it("projects current Campus Docs evidence into browser source items", () => {
		const parts = normalizeSourceItemsPart({
			result: {
				sources: [
					{
						document_id: "curriculum_plan/computer-science",
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
						collectionLabel: "培养方案",
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

	it("ignores legacy source metadata when rebuilding persisted Campus Docs items", () => {
		const parts = normalizeChatStructuredParts([
			{
				sourceItems: [
					{
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

		expect(parts).toMatchObject([
			{
				sourceItems: [
					{
						primaryAction: {
							external: false,
							href: "/docs/regulations/student_rules/student-handbook/v/2026-current#network-use",
							label: "查看文档",
						},
						title: "学生手册",
					},
				],
				type: "source_items",
			},
		]);
		const encoded = JSON.stringify(parts);
		expect(encoded).not.toContain("legacyRouting");
	});

	it("drops non-document and malformed source references", () => {
		const runtimeParts = normalizeSourceItemsPart({
			result: {
				sources: [
					{ section_ref: "https://muc.edu.cn/news/1#details", title: "公开网页" },
					{ section_ref: "s3://bucket/private.json#unit", title: "内部对象" },
					{ section_ref: "/docs/../private#unit", title: "越界路径" },
					{ section_ref: "", title: "无效来源" },
				],
			},
			status: "completed",
		});
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

		expect(runtimeParts).toEqual([]);
		expect(persistedParts).toEqual([]);
	});
});
