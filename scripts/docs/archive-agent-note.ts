import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const notePath =
	/^(architecture|bug-fix|feature|process|simplification|testing)\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;

export function archiveNote(root: string, source: string, replacement?: string): string {
	const implemented = resolve(root, ".agents/notes/implemented");
	const absolute = resolve(root, source);
	const relativeSource = relative(implemented, absolute).split(sep).join("/");
	if (!notePath.test(relativeSource)) {
		throw new Error("只能归档 implemented 下按 class/日期-topic.md 命名的笔记");
	}
	if (!existsSync(absolute)) {
		throw new Error("源笔记不存在");
	}
	const original = readFileSync(absolute);
	const body = original.toString("utf8");
	if (body.split(/\r?\n/u)[2] !== "Status: implemented" || /^Archived:/mu.test(body)) {
		throw new Error("源笔记须为尚未归档的 Status: implemented");
	}
	const target = resolve(root, ".agents/notes/archived", relativeSource);
	if (existsSync(target)) {
		throw new Error("归档目标已存在，不得覆盖");
	}
	let replacementText = "";
	if (replacement) {
		const replacementPath = resolve(root, replacement);
		const relativeReplacement = relative(implemented, replacementPath).split(sep).join("/");
		if (
			!notePath.test(relativeReplacement) ||
			replacementPath === absolute ||
			!existsSync(replacementPath)
		) {
			throw new Error("替代目标须为另一篇现存 implemented 笔记");
		}
		if (readFileSync(replacementPath, "utf8").split(/\r?\n/u)[2] !== "Status: implemented") {
			throw new Error("替代目标须为 Status: implemented");
		}
		const link = relative(dirname(target), replacementPath).split(sep).join("/");
		replacementText = ` — superseded by [替代笔记](${link})`;
	}
	const separator = body.endsWith("\n") ? "\n" : "\n\n";
	const marker = `${separator}Archived: ${new Date().toISOString().slice(0, 10)}${replacementText}\n`;
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, Buffer.concat([original, Buffer.from(marker)]), { flag: "wx" });
	unlinkSync(absolute);
	return relative(root, target).split(sep).join("/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const [source, flag, replacement, ...extra] = process.argv.slice(2);
	try {
		if (
			!source ||
			(flag !== undefined && (flag !== "--superseded-by" || !replacement)) ||
			extra.length > 0
		) {
			throw new Error(
				"用法：tsx scripts/docs/archive-agent-note.ts <note> [--superseded-by <note>]",
			);
		}
		console.log(`Archived ${source} -> ${archiveNote(process.cwd(), source, replacement)}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
