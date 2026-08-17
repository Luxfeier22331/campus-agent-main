import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const docsDir = resolve(process.cwd(), "docs");
const decisionsDir = resolve(process.cwd(), "docs/decisions");
const files = readdirSync(decisionsDir)
	.filter((name) => /^adr-\d{4}-.+\.md$/u.test(name))
	.sort();
const filesById = new Map<string, string[]>();
const errors: string[] = [];

function markdownFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				return markdownFiles(path);
			}
			return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
		})
		.sort();
}

const ownerDocuments = markdownFiles(docsDir)
	.filter((path) => !path.startsWith(`${decisionsDir}${sep}`))
	.map((path) => ({
		content: readFileSync(path, "utf8"),
		file: relative(process.cwd(), path),
	}));

for (const file of files) {
	const content = readFileSync(resolve(decisionsDir, file), "utf8");
	const filenameId = file.match(/^adr-(\d{4})-/u)?.[1];
	const decisionId = content.match(/^decision_id:\s*ADR-(\d{4})\s*$/mu)?.[1];
	const headingId = content.match(/^# ADR-(\d{4})(?::|：|\s)/mu)?.[1];

	if (!decisionId) {
		errors.push(`${file}: missing decision_id: ADR-XXXX`);
		continue;
	}
	const id = `ADR-${decisionId}`;
	filesById.set(id, [...(filesById.get(id) ?? []), file]);
	if (filenameId !== decisionId) {
		errors.push(`${file}: filename id does not match ${id}`);
	}
	if (headingId !== decisionId) {
		errors.push(`${file}: H1 id does not match ${id}`);
	}
	const referenced = ownerDocuments.some(
		(document) => document.content.includes(id) || document.content.includes(file),
	);
	if (!referenced) {
		errors.push(`${file}: accepted ADR 没有当前所有者文档引用`);
	}
}

for (const [id, matchingFiles] of filesById) {
	if (matchingFiles.length > 1) {
		errors.push(`${id}: duplicate decision id in ${matchingFiles.join(", ")}`);
	}
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	console.log(`ADR identity check passed for ${files.length} decisions.`);
}
