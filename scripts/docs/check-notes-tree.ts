import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const notesDir = resolve(process.cwd(), ".agents/notes");
const lifecycles = new Set(["proposed", "implemented", "rejected", "archived"]);
const classes = new Set([
	"feature",
	"bug-fix",
	"simplification",
	"architecture",
	"process",
	"testing",
]);
const filenamePattern = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const numberedFilenamePattern = /(?:^|-)adr-?\d+(?=-|\.md$)/iu;
const activeLifecycles = new Set(["proposed", "implemented", "rejected"]);
const errors: string[] = [];

if (existsSync(notesDir)) {
	const entries = readdirSync(notesDir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "README.md") {
			continue;
		}
		if (entry.name === "templates") {
			continue;
		}
		if (!entry.isDirectory()) {
			errors.push(`.agents/notes/${entry.name}: 顶层只允许 lifecycle 目录和 README.md`);
			continue;
		}
		if (!lifecycles.has(entry.name)) {
			errors.push(`.agents/notes/${entry.name}: 未知 lifecycle`);
		}
		for (const classEntry of readdirSync(resolve(notesDir, entry.name), {
			withFileTypes: true,
		})) {
			const classPath = `.agents/notes/${entry.name}/${classEntry.name}`;
			if (classEntry.name === "INDEX.md") {
				errors.push(`${classPath}: 禁止维护索引文件`);
				continue;
			}
			if (!classEntry.isDirectory()) {
				errors.push(`${classPath}: lifecycle 下只允许 class 目录`);
				continue;
			}
			if (!classes.has(classEntry.name)) {
				errors.push(`${classPath}: 未知 class`);
			}
			for (const file of readdirSync(resolve(notesDir, entry.name, classEntry.name))) {
				const filePath = `${classPath}/${file}`;
				if (!file.endsWith(".md")) {
					errors.push(`${filePath}: 只允许 Markdown 笔记`);
					continue;
				}
				if (!filenamePattern.test(file)) {
					errors.push(`${filePath}: 文件名须为 yyyy-mm-dd-topic.md`);
				}
				if (activeLifecycles.has(entry.name) && numberedFilenamePattern.test(file)) {
					errors.push(`${filePath}: 活动笔记文件名须使用话题名，不得包含 ADR 编号`);
				}
			}
		}
	}

	let noteCount = 0;
	for (const lifecycle of ["proposed", "implemented", "rejected", "archived"]) {
		const lifecycleDir = resolve(notesDir, lifecycle);
		if (!existsSync(lifecycleDir)) {
			continue;
		}
		for (const classEntry of readdirSync(lifecycleDir, { withFileTypes: true })) {
			if (!classEntry.isDirectory()) {
				continue;
			}
			for (const file of readdirSync(resolve(lifecycleDir, classEntry.name))) {
				if (!file.endsWith(".md")) {
					continue;
				}
				noteCount += 1;
				if (lifecycle === "archived") {
					continue;
				}
				const path = resolve(lifecycleDir, classEntry.name, file);
				const content = readFileSync(path, "utf8");
				for (const match of content.matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/gu)) {
					const target = match[1] ?? "";
					if (target.includes("://") || target.startsWith("/")) {
						continue;
					}
					const resolved = resolve(path, "..", target);
					if (!existsSync(resolved)) {
						errors.push(`${relative(process.cwd(), path)}: 笔记链接不存在 ${target}`);
					}
				}
			}
		}
	}

	if (errors.length > 0) {
		for (const error of errors) {
			console.error(error);
		}
		process.exitCode = 1;
	} else {
		console.log(`Notes tree check passed for ${noteCount} notes.`);
	}
} else {
	console.error(".agents/notes 目录不存在");
	process.exitCode = 1;
}
