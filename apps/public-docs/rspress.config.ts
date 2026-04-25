import * as path from "node:path";
import { defineConfig } from "@rspress/core";

export default defineConfig({
	root: path.join(__dirname, "docs"),
	title: "Campus Agent 文档站",
	description: "Campus Agent 正式公开文档站，接入当前公开文档样本。",
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
