import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const markdownPathspec = "*.md";
const cjkPattern = /[\u3400-\u9fff]/u;
const latinPattern = /[A-Za-z]/gu;
const longEnglishLineThreshold = 48;

function requiresChineseProse(file: string): boolean {
	return !file.startsWith(".github/");
}

interface AddedLine {
	file: string;
	lineNumber: number;
}

function git(args: string[], allowFailure = false): string {
	try {
		return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
	} catch (error) {
		if (allowFailure) {
			return "";
		}
		throw error;
	}
}

function lines(value: string): string[] {
	return value ? value.split("\n").filter(Boolean) : [];
}

function resolveBase(): string | null {
	for (const ref of ["refs/remotes/origin/main", "main"]) {
		const base = git(["merge-base", "HEAD", ref], true);
		if (base) {
			return base;
		}
	}
	return null;
}

function parseAddedLines(diff: string): AddedLine[] {
	const added: AddedLine[] = [];
	let file = "";
	let lineNumber = 0;

	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ b/")) {
			file = line.slice(6);
			continue;
		}
		const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
		if (hunk) {
			lineNumber = Number.parseInt(hunk[1] ?? "0", 10);
			continue;
		}
		if (!file || line.startsWith("--- ") || line.startsWith("\\")) {
			continue;
		}
		if (line.startsWith("+")) {
			added.push({ file, lineNumber });
			lineNumber += 1;
			continue;
		}
		if (!line.startsWith("-")) {
			lineNumber += 1;
		}
	}
	return added;
}

function proseLines(content: string): boolean[] {
	const sourceLines = content.split(/\r?\n/u);
	const prose = Array.from({ length: sourceLines.length }, () => true);
	let inFrontmatter = sourceLines[0] === "---";
	let inFence = false;
	let inComment = false;

	for (const [index, line] of sourceLines.entries()) {
		if (inFrontmatter) {
			prose[index] = false;
			if (index > 0 && line === "---") {
				inFrontmatter = false;
			}
			continue;
		}
		if (/^\s*(```|~~~)/u.test(line)) {
			prose[index] = false;
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			prose[index] = false;
			continue;
		}
		if (inComment || line.includes("<!--")) {
			prose[index] = false;
			inComment = !line.includes("-->");
		}
	}
	return prose;
}

function cleanProse(line: string): string {
	return line
		.replace(/!?(\[[^\]]*\])\([^)]*\)/gu, "$1")
		.replace(/`[^`]*`/gu, "")
		.replace(/https?:\/\/\S+/gu, "")
		.replace(/<[^>]+>/gu, "")
		.trim();
}

function proseBlock(input: {
	index: number;
	lines: string[];
	prose: boolean[];
}): { start: number; value: string } | null {
	const current = input.lines[input.index] ?? "";
	const technicalLink =
		/^\s*\[[A-Za-z0-9_./-]+\]:\s*\S+\s*$/u.test(current) ||
		/^\s*[-*+]\s+\[[A-Za-z0-9_./-]+\]\([^)]+\)\s*$/u.test(current);
	if (
		!input.prose[input.index] ||
		current.trim() === "" ||
		/^\s*\|/u.test(current) ||
		technicalLink
	) {
		return null;
	}

	const listItem = /^\s*(?:[-*+] |\d+\. )/u;
	const boundary = (line: string, index: number): boolean =>
		!input.prose[index] || line.trim() === "" || /^\s*(?:#{1,6} |\|)/u.test(line);
	let start = input.index;
	while (start > 0 && !boundary(input.lines[start - 1] ?? "", start - 1)) {
		if (listItem.test(input.lines[start] ?? "")) {
			break;
		}
		start -= 1;
		if (listItem.test(input.lines[start] ?? "")) {
			break;
		}
	}

	let end = input.index + 1;
	while (end < input.lines.length && !boundary(input.lines[end] ?? "", end)) {
		if (listItem.test(input.lines[end] ?? "")) {
			break;
		}
		end += 1;
	}

	return {
		start,
		value: input.lines.slice(start, end).map(cleanProse).join(" "),
	};
}

const base = resolveBase();
const diffArgs = ["diff", "--unified=0", "--no-color", "--no-ext-diff"];
if (base) {
	diffArgs.push(base);
} else {
	diffArgs.push("HEAD");
}
diffArgs.push("--", markdownPathspec);

const addedLines = parseAddedLines(git(diffArgs)).filter(({ file }) => requiresChineseProse(file));
const docsFiles = lines(git(["ls-files", markdownPathspec]))
	.filter((file) => file.endsWith(".md"))
	.filter(requiresChineseProse)
	.filter((file) => existsSync(file));
const newFiles = new Set(
	lines(
		git(["diff", "--name-only", "--diff-filter=A", base ?? "HEAD", "--", markdownPathspec]),
	).filter(requiresChineseProse),
);
for (const file of lines(
	git(["ls-files", "--others", "--exclude-standard", "--", markdownPathspec]),
)) {
	if (!requiresChineseProse(file)) {
		continue;
	}
	newFiles.add(file);
	const count = readFileSync(file, "utf8").split(/\r?\n/u).length;
	for (let lineNumber = 1; lineNumber <= count; lineNumber += 1) {
		addedLines.push({ file, lineNumber });
	}
}

const files = new Map<string, { lines: string[]; prose: boolean[] }>();
const errors = new Set<string>();
const checkedBlocks = new Set<string>();

const linesToCheck = [
	...docsFiles.flatMap((file) => {
		const count = readFileSync(file, "utf8").split(/\r?\n/u).length;
		return Array.from({ length: count }, (_, index) => ({ file, lineNumber: index + 1 }));
	}),
	...addedLines,
];

for (const { file, lineNumber } of linesToCheck) {
	if (!existsSync(file)) {
		continue;
	}
	let entry = files.get(file);
	if (!entry) {
		const content = readFileSync(file, "utf8");
		entry = { lines: content.split(/\r?\n/u), prose: proseLines(content) };
		files.set(file, entry);
	}
	const block = proseBlock({ index: lineNumber - 1, lines: entry.lines, prose: entry.prose });
	if (!block) {
		continue;
	}
	const blockKey = `${file}:${block.start}`;
	if (checkedBlocks.has(blockKey)) {
		continue;
	}
	checkedBlocks.add(blockKey);
	const latinCount = block.value.match(latinPattern)?.length ?? 0;
	if (latinCount >= longEnglishLineThreshold && !cjkPattern.test(block.value)) {
		errors.add(`${file}:${block.start + 1}: 长叙述段必须使用中文`);
	}
}

for (const file of new Set([...docsFiles, ...newFiles])) {
	if (!existsSync(file)) {
		continue;
	}
	const content = readFileSync(file, "utf8");
	const flags = proseLines(content);
	const prose = content
		.split(/\r?\n/u)
		.filter((_, index) => flags[index])
		.map(cleanProse)
		.join("\n");
	if (!cjkPattern.test(prose)) {
		errors.add(`${file}: 人类可读文档必须包含中文正文`);
	}
}

if (errors.size > 0) {
	for (const error of [...errors].sort()) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	console.log(
		`Chinese prose check passed for ${docsFiles.length} tracked Markdown files and ${files.size} changed Markdown files.`,
	);
}
