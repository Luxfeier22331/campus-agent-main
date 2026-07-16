import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const docsDir = resolve(process.cwd(), "docs");
const requiredKeys = ["doc_type", "owner_boundary", "status"] as const;
const forbiddenKeys = new Set(["truth_scope", "created", "updated"]);
const allowedStatuses = new Set([
	"active",
	"historical",
	"proposed",
	"accepted",
	"superseded",
	"deprecated",
]);
const errors: string[] = [];

function markdownFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				return markdownFiles(path);
			}
			return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
		})
		.sort();
}

const files = markdownFiles(docsDir);
for (const path of files) {
	const file = relative(process.cwd(), path);
	const lines = readFileSync(path, "utf8").split(/\r?\n/u);
	if (lines[0] !== "---") {
		errors.push(`${file}: 缺少 frontmatter`);
		continue;
	}
	const end = lines.indexOf("---", 1);
	if (end < 0) {
		errors.push(`${file}: frontmatter 未闭合`);
		continue;
	}

	const values = new Map<string, string>();
	let currentKey: string | null = null;
	for (const [index, line] of lines.slice(1, end).entries()) {
		if (line.trim() === "") {
			continue;
		}
		const match = line.match(/^([a-z][a-z0-9_]*):(?:\s*(.*))?$/u);
		if (!match) {
			if (currentKey && /^\s+-\s+\S/u.test(line)) {
				continue;
			}
			errors.push(`${file}:${index + 2}: 无法识别的 frontmatter 行`);
			currentKey = null;
			continue;
		}
		const [, key = "", value = ""] = match;
		if (values.has(key)) {
			errors.push(`${file}:${index + 2}: 重复字段 ${key}`);
		}
		values.set(key, value.trim());
		currentKey = key;
	}

	for (const key of requiredKeys) {
		if (!values.get(key)) {
			errors.push(`${file}: 缺少 ${key}`);
		}
	}
	for (const key of forbiddenKeys) {
		if (values.has(key)) {
			errors.push(`${file}: 不再维护 ${key}`);
		}
	}
	const status = values.get("status");
	if (status && !allowedStatuses.has(status)) {
		errors.push(`${file}: 无效 status ${status}`);
	}
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	console.log(`Documentation frontmatter check passed for ${files.length} files.`);
}
