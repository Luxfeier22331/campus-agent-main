import path from "node:path";
import { defineConfig } from "@rspress/core";
import { campusDocsSearchIndexPlugin } from "./scripts/rspress-search-index-plugin";
import { buildRspressSidebarConfig } from "./scripts/rspress-sidebar";
import { buildRspressProductNav } from "./src/platform/navigation/product-nav";

const docsRoot = path.resolve(
	__dirname,
	process.env.CAMPUS_WEB_RSPRESS_DOCS_ROOT?.trim() || "docs",
);

export default defineConfig({
	builderConfig: {
		output: {
			assetPrefix: "/_docs-static/",
			distPath: {
				assets: "assets",
				css: "css",
				cssAsync: "css/async",
				font: "font",
				image: "image",
				js: "js",
				jsAsync: "js/async",
				media: "media",
				svg: "svg",
				wasm: "wasm",
			},
		},
		source: {
			alias: {
				"@": path.resolve(__dirname, "src"),
			},
		},
	},
	description: "中央民族大学校园问答内的文档阅读面。",
	globalUIComponents: [
		path.join(__dirname, "src/components/docs/mobile-sidebar-guard.tsx"),
		path.join(__dirname, "src/components/docs/docs-content-enhancer.tsx"),
		path.join(__dirname, "src/components/docs/reader-state-enhancer.tsx"),
	],
	i18nSource: {
		searchNoResultsText: {
			en: "No matching results",
			zh: "未找到匹配结果",
		},
		searchPanelCancelText: {
			en: "Cancel",
			zh: "取消",
		},
		searchPlaceholderText: {
			en: "Search",
			zh: "搜索文档",
		},
	},
	lang: "zh",
	locales: [{ lang: "zh", label: "中文" }],
	logoHref: "/",
	logoText: "中央民族大学校园问答",
	plugins: [campusDocsSearchIndexPlugin()],
	root: docsRoot,
	route: {
		cleanUrls: true,
	},
	search: {
		mode: "local",
		searchHooks: path.join(__dirname, "src/docs/search/rspress-search-hooks.tsx"),
	},
	themeConfig: {
		darkMode: false,
		enableContentAnimation: false,
		nav: buildRspressProductNav(),
		outlineTitle: "本页",
		sidebar: buildRspressSidebarConfig(docsRoot),
	},
	theme: path.join(__dirname, "theme"),
	title: "中央民族大学校园问答",
});
