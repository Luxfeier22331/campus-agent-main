import path from "node:path";
import { defineConfig } from "@rspress/core";

const docsRoot = path.join(__dirname, "docs");

export default defineConfig({
	description: "中央民族大学校园问答内的文档阅读面。",
	globalUIComponents: [path.join(__dirname, "src/components/docs/reader-state-enhancer.tsx")],
	lang: "zh",
	logoHref: "/",
	logoText: "中央民族大学校园问答",
	root: docsRoot,
	search: {
		mode: "local",
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
		sidebar: {
			"/docs/": [
				{
					items: [
						{
							link: "/docs/regulations/student_rules/",
							text: "学生手册",
						},
					],
					text: "规章制度",
				},
			],
		},
	},
	title: "中央民族大学校园问答",
});
