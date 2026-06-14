import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/u, "");
const docsRoot = join(appRoot, "docs");

writeText(
	join(docsRoot, "_meta.json"),
	`[
\t{ "type": "file", "name": "index", "label": "文档" },
\t{ "type": "dir", "name": "docs", "label": "文档库", "collapsed": false }
]\n`,
);
writeText(
	join(docsRoot, "index.md"),
	`---
title: 文档
footer: false
outline: false
---

## 文档

请选择左侧目录中的文档继续阅读。
`,
);
writeText(
	join(docsRoot, "docs", "_meta.json"),
	`[{ "type": "dir", "name": "regulations", "label": "规章制度", "collapsed": false }]\n`,
);
writeText(
	join(docsRoot, "docs", "index.md"),
	`---
title: 文档库
footer: false
outline: false
---

## 文档库

请选择文档集合继续阅读。
`,
);
writeText(
	join(docsRoot, "docs", "regulations", "_meta.json"),
	`[{ "type": "dir", "name": "student_rules", "label": "学生手册", "collapsed": false }]\n`,
);
writeText(
	join(docsRoot, "docs", "regulations", "student_rules", "_meta.json"),
	`[{ "type": "file", "name": "index", "label": "学生手册" }]\n`,
);
writeText(
	join(docsRoot, "docs", "regulations", "student_rules", "index.md"),
	`---
title: 学生手册
footer: false
outline: false
---

## 学生手册

暂无已发布文档。
`,
);

function writeText(path, content) {
	if (existsSync(path)) {
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}
