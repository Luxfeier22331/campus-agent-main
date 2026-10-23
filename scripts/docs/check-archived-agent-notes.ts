import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checkArchivedNotes(root = process.cwd()): string[] {
	const archived = resolve(root, ".agents/notes/archived");
	const errors: string[] = [];
	const committed = new Map<string, Buffer>();
	const hasHead =
		spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, stdio: "ignore" }).status ===
		0;
	if (hasHead) {
		const files = execFileSync(
			"git",
			["ls-tree", "-rz", "--name-only", "HEAD", "--", ".agents/notes/archived"],
			{ cwd: root, encoding: "utf8" },
		);
		for (const file of files.split("\0").filter((file) => file.endsWith(".md"))) {
			const path = resolve(root, file);
			const original = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root });
			committed.set(path, original);
			if (!existsSync(path)) {
				errors.push(`${file}: 已提交归档不得删除`);
			} else if (!readFileSync(path).equals(original)) {
				errors.push(`${file}: 已提交归档不得修改`);
			}
		}
	}
	if (!existsSync(archived)) {
		return errors;
	}
	for (const category of readdirSync(archived, { withFileTypes: true })) {
		if (!category.isDirectory()) {
			continue;
		}
		for (const entry of readdirSync(resolve(archived, category.name), { withFileTypes: true })) {
			if (!(entry.isFile() && entry.name.endsWith(".md"))) {
				continue;
			}
			const path = resolve(archived, category.name, entry.name);
			const file = relative(root, path);
			const lines = readFileSync(path, "utf8").split(/\r?\n/u);
			if (lines[2] !== "Status: implemented") {
				errors.push(`${file}: 归档须保留原 Status: implemented`);
			}
			const markers = lines.filter((line) => line.startsWith("Archived:"));
			if (markers.length !== 1) {
				errors.push(`${file}: 必须且只能有一条 Archived: 归档说明`);
				continue;
			}
			const marker = markers[0]?.match(
				/^Archived: (\d{4}-\d{2}-\d{2})(?: — superseded by \[替代笔记\]\(([^)]+)\))?$/u,
			);
			if (
				!marker ||
				Number.isNaN(Date.parse(marker[1] ?? "")) ||
				new Date(marker[1] ?? "").toISOString().slice(0, 10) !== marker[1]
			) {
				errors.push(`${file}: Archived: 日期或替代链接格式错误`);
				continue;
			}
			// 已提交归档的历史链接不随当前目录变化重新校验。
			if (marker[2] && !committed.has(path)) {
				const replacement = resolve(dirname(path), marker[2]);
				if (
					!(
						replacement.startsWith(`${resolve(root, ".agents/notes/implemented")}/`) &&
						existsSync(replacement)
					) ||
					readFileSync(replacement, "utf8").split(/\r?\n/u)[2] !== "Status: implemented"
				) {
					errors.push(`${file}: 新归档的替代链接须指向现存 implemented 笔记`);
				}
			}
		}
	}
	return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const errors = checkArchivedNotes();
	if (errors.length > 0) {
		for (const error of errors) {
			console.error(error);
		}
		process.exitCode = 1;
	} else {
		console.log("Archived notes metadata and Git HEAD freeze check passed.");
	}
}
