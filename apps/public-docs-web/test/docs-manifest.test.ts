import { describe, expect, it } from "vitest";
import { buildDocsManifestFromFiles, normalizeDocFilePath } from "../src/lib/docs-manifest.shared";

describe("docs manifest builder", () => {
	it("maps index files to docs routes and keeps content file paths for client loading", () => {
		const manifest = buildDocsManifestFromFiles({
			"index.md": `---
title: 文档目录
description: 入口
---
`,
			"regulations/index.md": `---
title: 规章制度
description: 顶层目录
---
`,
			"regulations/student-handbook/index.md": `---
title: 学生手册
description: 二级目录
---
`,
			"regulations/student-handbook/academic-status-and-course-registration.md": `---
title: 学籍与选课
description: 样本文档
---
`,
		});

		expect(normalizeDocFilePath("index.md").routePath).toBe("/docs");
		expect(
			normalizeDocFilePath(
				"regulations/student-handbook/academic-status-and-course-registration.md",
			).routePath,
		).toBe("/docs/regulations/student-handbook/academic-status-and-course-registration");

		expect(manifest.pageByRoute["/docs"]).toMatchObject({
			title: "文档目录",
			path: "index.md",
			markdownUrl: "/llms.mdx/docs/content.md",
		});
		expect(
			manifest.pageByRoute[
				"/docs/regulations/student-handbook/academic-status-and-course-registration"
			],
		).toMatchObject({
			title: "学籍与选课",
			path: "regulations/student-handbook/academic-status-and-course-registration.md",
			markdownUrl:
				"/llms.mdx/docs/regulations/student-handbook/academic-status-and-course-registration/content.md",
		});
	});
});
