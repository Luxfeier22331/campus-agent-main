import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(__dirname, "..");

describe("user-facing copy guard", () => {
	it("does not pass raw technical errors from route code into visible UI", () => {
		const routeFiles = [
			"home-page.tsx",
			"conversation-page.tsx",
			"docs-page.tsx",
			"map-page.tsx",
			"dining-page.tsx",
			"feedback-page.tsx",
		];

		for (const fileName of routeFiles) {
			const source = readFileSync(join(appDir, "src", "app", "routes", fileName), "utf8");
			expect(source, fileName).not.toContain("reason instanceof Error ? reason.message");
			expect(source, fileName).not.toContain("event.data.error?.message");
		}
	});

	it("does not return development infrastructure wording from public worker api errors", () => {
		const source = readFileSync(join(appDir, "src", "index.ts"), "utf8");
		for (const phrase of [
			"App API binding is not configured.",
			"App API upstream is unavailable.",
			"Campus API route is not allowlisted.",
			"Campus frontend assets are not configured.",
			"Runtime configuration is incomplete.",
		]) {
			expect(source).not.toContain(phrase);
		}
	});

	it("does not keep implementation wording in browser route copy", () => {
		const checks = [
			{
				fileName: "root-layout.tsx",
				phrases: ["campus-web 注册"],
				sourcePath: ["src", "app"],
			},
			{
				fileName: "conversation-page.tsx",
				phrases: ["hover 菜单", "历史会话会显示在这里，方便继续查看之前的问题。"],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "home-page.tsx",
				phrases: [
					"回答会在对话中给出，并在需要时打开文档、校园地图或饭堂分布图。",
					"信息以原始来源和现场情况为准。",
					"暂时无法读取历史会话。",
				],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "docs-page.tsx",
				phrases: [
					"reader asset",
					"reader 内容",
					'deliveryMode ?? "reader"',
					"完整正文可在文档页面中查看。",
					"打开文档正文",
				],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "map-page.tsx",
				phrases: [
					"sourceRefs",
					"projection",
					"筛选已投影地点",
					"投影来源",
					"地图暂未接入",
					"开发中",
				],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "feedback-page.tsx",
				phrases: ["提交问题", "相关页面"],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "qa-shell.tsx",
				phrases: [
					"登录后会在这里显示历史会话。",
					"历史会话只用于找回之前的问题；文档、校园地图和饭堂分布图保留在顶部导航中。",
					"搜索历史会话",
					"ChatKit 管理",
					"showArchivedConversations",
					"historyView",
				],
				sourcePath: ["src", "components", "conversation"],
			},
			{
				fileName: "chatkit-conversation-surface.tsx",
				phrases: [
					"OAuth",
					"fetch failed",
					"provider",
					"runId",
					"staging",
					"traceId",
					"view=archived",
					"archived",
					"开发中",
					"暂未接入",
					"联邦",
				],
				sourcePath: ["src", "components", "conversation"],
			},
		];

		for (const check of checks) {
			const source = readFileSync(join(appDir, ...check.sourcePath, check.fileName), "utf8");
			for (const phrase of check.phrases) {
				expect(source, `${check.fileName}: ${phrase}`).not.toContain(phrase);
			}
		}
	});
});
