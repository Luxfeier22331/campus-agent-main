import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { localMarkdownTargets, repositoryMarkdownFiles, resolveTarget } from "./check-links.ts";

export function noteAnchorReport(root = process.cwd()): string[] {
	const files = repositoryMarkdownFiles(root);
	const notesRoot = resolve(root, ".agents/notes");
	const notes = files.filter((path) => path.startsWith(`${notesRoot}/implemented/`));
	const references = new Map(notes.map((path) => [path, new Set<string>()]));
	for (const source of files) {
		if (
			source.startsWith(`${notesRoot}/archived/`) ||
			source.startsWith(`${notesRoot}/templates/`)
		) {
			continue;
		}
		let inFence = false;
		for (const line of readFileSync(source, "utf8").split(/\r?\n/u)) {
			if (/^\s*(```|~~~)/u.test(line)) {
				inFence = !inFence;
				continue;
			}
			if (inFence) {
				continue;
			}
			for (const link of localMarkdownTargets(line, true)) {
				const target = resolveTarget(root, source, link);
				if (target && target !== source) {
					references.get(target)?.add(source);
				}
			}
		}
	}
	const report = ["引用观察（informational）：无 owner 引用或高引用量不代表缺陷。"];
	for (const [note, sources] of references) {
		const owners = [...sources].filter((source) => {
			const path = relative(root, source);
			return !(
				path.startsWith(".agents/") ||
				path === "README.md" ||
				path.endsWith("AGENTS.md") ||
				(path.startsWith("docs/") && path.endsWith("/README.md"))
			);
		});
		if (owners.length === 0) {
			report.push(
				`informational: 无 owner 文档引用（总入站 ${sources.size}）：${relative(root, note)}`,
			);
		}
		if (sources.size > 2) {
			report.push(`informational: 高引用量（${sources.size} 个来源文件）：${relative(root, note)}`);
		}
	}
	return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		for (const line of noteAnchorReport()) {
			console.log(line);
		}
	} catch (error) {
		console.log(
			`informational: 引用报告未完成：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
