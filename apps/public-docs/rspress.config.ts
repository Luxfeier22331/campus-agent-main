import * as path from "node:path";
import { defineConfig } from "@rspress/core";
import { buildRspressSidebarConfig } from "./scripts/rspress-sidebar";

const docsRoot = path.join(__dirname, "docs");

export default defineConfig({
	root: docsRoot,
	title: "校园助手公开文档",
	description: "校园助手公开文档站，集中阅读学生手册、培养方案与公开规章。",
	icon: "/favicon.ico",
	logoText: "校园助手",
	logoHref: "/",
	lang: "zh",
	globalUIComponents: [
		path.join(__dirname, "src/components/SearchKeyboardGuard.tsx"),
		path.join(__dirname, "src/components/MobileSidebarGuard.tsx"),
		path.join(__dirname, "src/components/DocsContentEnhancer.tsx"),
		path.join(__dirname, "src/components/ReaderStateEnhancer.tsx"),
	],
	search: {
		mode: "local",
		searchHooks: path.join(__dirname, "src/search/local-search-fallback.ts"),
	},
	themeConfig: {
		darkMode: false,
		enableContentAnimation: false,
		nav: [],
		sidebar: buildRspressSidebarConfig(docsRoot),
		socialLinks: [
			{
				icon: "github",
				mode: "link",
				content: "https://github.com/MUC-WIKI/campus-agent",
			},
		],
	},
});
