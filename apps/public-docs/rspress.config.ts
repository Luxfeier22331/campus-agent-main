import * as path from "node:path";
import { defineConfig } from "@rspress/core";

export default defineConfig({
	root: path.join(__dirname, "docs"),
	title: "校园公开文档",
	description: "校园公开文档站，集中阅读学生手册、培养方案与公开规章。",
	lang: "zh",
	globalUIComponents: [path.join(__dirname, "src/components/SearchKeyboardGuard.tsx")],
	search: {
		mode: "local",
		searchHooks: path.join(__dirname, "src/search/local-search-fallback.ts"),
	},
	themeConfig: {
		darkMode: false,
		enableContentAnimation: false,
		socialLinks: [
			{
				icon: "github",
				mode: "link",
				content: "https://github.com/MUC-WIKI/campus-agent",
			},
		],
	},
});
