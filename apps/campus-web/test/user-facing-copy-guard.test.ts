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
				phrases: ["hover 菜单"],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "docs-page.tsx",
				phrases: ["reader asset", "reader 内容", 'deliveryMode ?? "reader"'],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "map-page.tsx",
				phrases: ["筛选已投影地点", "投影来源"],
				sourcePath: ["src", "app", "routes"],
			},
			{
				fileName: "message-list.tsx",
				phrases: ["未返回来源卡片"],
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
