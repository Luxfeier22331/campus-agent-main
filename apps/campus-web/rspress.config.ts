import path from "node:path";
import { defineConfig } from "@rspress/core";
import { buildRspressSidebarConfig } from "./scripts/rspress-sidebar";

const docsRoot = path.join(__dirname, "docs");

export default defineConfig({
	description: "中央民族大学校园问答内的文档阅读面。",
	globalUIComponents: [
		path.join(__dirname, "src/components/docs/search-keyboard-guard.tsx"),
		path.join(__dirname, "src/components/docs/mobile-sidebar-guard.tsx"),
		path.join(__dirname, "src/components/docs/docs-content-enhancer.tsx"),
		path.join(__dirname, "src/components/docs/reader-state-enhancer.tsx"),
	],
	lang: "zh",
	logoHref: "/",
	logoText: "中央民族大学校园问答",
	root: docsRoot,
	search: {
		mode: "local",
		searchHooks: path.join(__dirname, "src/docs/search/docs-search-hook.ts"),
	},
	themeConfig: {
		darkMode: false,
		enableContentAnimation: false,
		nav: [
			{ link: "/", text: "问答" },
			{ link: "/map", text: "校园地图" },
			{ link: "/dining", text: "饭堂分布图" },
			{ link: "/feedback", text: "反馈" },
		],
		outlineTitle: "本页",
		sidebar: buildRspressSidebarConfig(docsRoot),
	},
	theme: path.join(__dirname, "theme"),
	title: "中央民族大学校园问答",
});
