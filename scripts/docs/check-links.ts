import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = process.cwd();
const errors = new Set<string>();

function repositoryMarkdownFiles(): string[] {
	const git = (args: string[]) =>
		execFileSync("git", args, {
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
		})
			.split("\n")
			.filter(Boolean);
	return [
		...new Set([
			...git(["ls-files", "*.md"]),
			...git(["ls-files", "--others", "--exclude-standard", "--", "*.md"]),
		]),
	]
		.map((path) => resolve(root, path))
		.filter((path) => existsSync(path))
		.sort();
}

function localMarkdownTargets(line: string, checkRepositoryCodePaths: boolean): string[] {
	const targets = new Set<string>();
	for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
		const raw = (match[1] ?? "").trim();
		const target =
			raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw.split(/\s+/u)[0];
		if (target) {
			targets.add(target);
		}
	}
	for (const match of line.matchAll(
		/`((?:docs\/|\.\.\/|\.\/)?[A-Za-z0-9_./-]+\.md(?:#[A-Za-z0-9_.-]+)?)`/gu,
	)) {
		const target = match[1] ?? "";
		if (target.includes("/")) {
			targets.add(target);
		}
	}
	const describesAbsentPath =
		/不存在|不再|不属于|不把|不得|不恢复|已删除|已移除|已退役|删除|历史|旧|退役|deprecated|removed|retired/iu.test(
			line,
		);
	if (checkRepositoryCodePaths && !describesAbsentPath) {
		for (const match of line.matchAll(
			/`((?:apps|configs|docs|env|infra|jobs|packages|scripts)\/[A-Za-z0-9_./-]+)`/gu,
		)) {
			const target = match[1] ?? "";
			if (
				target.includes("...") ||
				target.endsWith("/.env") ||
				target.endsWith("/.dev.vars") ||
				(target.startsWith("env/commands/") && !target.endsWith(".example"))
			) {
				continue;
			}
			targets.add(target);
		}
	}
	return [...targets].filter(Boolean);
}

function resolveTarget(source: string, target: string): string | null {
	const withoutAnchor = target.split("#", 1)[0]?.trim() ?? "";
	if (
		!withoutAnchor ||
		withoutAnchor.startsWith("/") ||
		withoutAnchor.startsWith("#") ||
		withoutAnchor.includes("://") ||
		/^[a-z][a-z0-9+.-]*:/iu.test(withoutAnchor)
	) {
		return null;
	}
	const rootPrefixes = [
		"apps/",
		"configs/",
		"docs/",
		"env/",
		"infra/",
		"jobs/",
		"packages/",
		"scripts/",
	];
	if (rootPrefixes.some((prefix) => withoutAnchor.startsWith(prefix))) {
		return resolve(root, withoutAnchor);
	}
	return resolve(dirname(source), withoutAnchor);
}

const files = repositoryMarkdownFiles();
for (const path of files) {
	const lines = readFileSync(path, "utf8").split(/\r?\n/u);
	const status = lines.find((line) => line.startsWith("status: "))?.slice("status: ".length);
	const checkRepositoryCodePaths = status !== "superseded" && status !== "deprecated";
	let inFence = false;
	for (const [index, line] of lines.entries()) {
		if (/^\s*(```|~~~)/u.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			continue;
		}
		for (const target of localMarkdownTargets(line, checkRepositoryCodePaths)) {
			const resolved = resolveTarget(path, target);
			if (resolved && !existsSync(resolved)) {
				errors.add(`${relative(root, path)}:${index + 1}: 不存在 ${target}`);
			}
		}
	}
}

if (errors.size > 0) {
	for (const error of [...errors].sort()) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	console.log(`Documentation link check passed for ${files.length} repository Markdown files.`);
}
