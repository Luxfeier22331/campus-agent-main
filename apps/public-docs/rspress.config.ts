import * as path from "node:path";
import { defineConfig } from "@rspress/core";

export default defineConfig({
	root: path.join(__dirname, "docs"),
	title: "Campus Agent 文档站",
	description: "Campus Agent 正式公开文档站，接入当前公开文档样本。",
	lang: "zh",
	themeConfig: {
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
