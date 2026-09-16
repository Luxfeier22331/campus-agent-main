import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { archiveNote } from "./archive-agent-note.ts";
import { checkArchivedNotes } from "./check-archived-agent-notes.ts";
import { checkDocumentationLinks } from "./check-links.ts";
import { noteAnchorReport } from "./check-note-anchors.ts";

function fixture(): string {
	const root = mkdtempSync(join("/tmp", "campus-agent-notes-"));
	mkdirSync(join(root, ".agents/notes/implemented/architecture"), { recursive: true });
	mkdirSync(join(root, ".agents/notes/implemented/process"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), "");
	return root;
}

function commit(root: string): void {
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
}

const note = "# Agent Note: 旧边界\n\nStatus: implemented\n\n## 决策\n\n保留原文。\n";

test("归档保留原文和状态，并写入相对替代链接", () => {
	const root = fixture();
	try {
		const source = ".agents/notes/implemented/architecture/2026-09-01-old-boundary.md";
		const replacement = ".agents/notes/implemented/process/2026-09-02-new-boundary.md";
		writeFileSync(join(root, source), note);
		writeFileSync(join(root, replacement), note.replace("旧边界", "新边界"));
		const target = archiveNote(root, source, replacement);
		assert.match(target, /archived\/architecture\/2026-09-01-old-boundary\.md$/u);
		const archived = readFileSync(join(root, target), "utf8");
		assert.ok(archived.startsWith(note));
		assert.match(
			archived,
			/Archived: \d{4}-\d{2}-\d{2} — superseded by \[替代笔记\]\(\.\.\/\.\.\/implemented\/process\/2026-09-02-new-boundary\.md\)/u,
		);
		assert.deepEqual(checkArchivedNotes(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("归档命令拒绝覆盖和非 implemented 源文件", () => {
	const root = fixture();
	try {
		const source = ".agents/notes/implemented/architecture/2026-09-01-old-boundary.md";
		writeFileSync(join(root, source), note);
		const target = archiveNote(root, source);
		assert.ok(!existsSync(join(root, source)));
		const original = readFileSync(join(root, target));
		writeFileSync(join(root, source), note);
		assert.throws(() => archiveNote(root, source), /不得覆盖/u);
		assert.deepEqual(readFileSync(join(root, target)), original);
		assert.equal(readFileSync(join(root, source), "utf8"), note);
		rmSync(join(root, source));
		assert.throws(() => archiveNote(root, source), /源笔记不存在|只能归档|尚未归档/u);
		assert.throws(() => archiveNote(root, ".agents/notes/implemented/../README.md"), /只能归档/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("已提交归档冻结后拒绝修改和删除", () => {
	const root = fixture();
	try {
		const source = ".agents/notes/implemented/architecture/2026-09-01-old-boundary.md";
		writeFileSync(join(root, source), note);
		archiveNote(root, source);
		commit(root);
		const archived = join(root, ".agents/notes/archived/architecture/2026-09-01-old-boundary.md");
		writeFileSync(archived, `${readFileSync(archived, "utf8")}\n改动\n`);
		assert.match(checkArchivedNotes(root).join("\n"), /不得修改/u);
		writeFileSync(archived, readFileSync(archived, "utf8").replace(/\n改动\n/u, ""));
		const errors = checkArchivedNotes(root);
		assert.deepEqual(errors, []);
		rmSync(archived);
		assert.match(checkArchivedNotes(root).join("\n"), /不得删除/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

const repositoryRoot = resolve(import.meta.dirname, "../..");
function run(root: string, script: string, args: string[] = []) {
	return spawnSync(
		resolve(repositoryRoot, "node_modules/.bin/tsx"),
		[resolve(repositoryRoot, "scripts/docs", script), ...args],
		{ cwd: root, encoding: "utf8" },
	);
}

test("归档缺失或重复标记会失败，缺失替代目标不移动源文件", () => {
	const root = fixture();
	try {
		const source = ".agents/notes/implemented/architecture/2026-09-01-old-boundary.md";
		writeFileSync(join(root, source), note);
		assert.throws(
			() =>
				archiveNote(root, source, ".agents/notes/implemented/architecture/2026-09-02-missing.md"),
			/替代目标/u,
		);
		assert.equal(readFileSync(join(root, source), "utf8"), note);
		const result = run(root, "archive-agent-note.ts", [source, "--superseded-by"]);
		assert.notEqual(result.status, 0);
		assert.equal(readFileSync(join(root, source), "utf8"), note);
		const target = join(root, archiveNote(root, source));
		const archived = readFileSync(target, "utf8");
		writeFileSync(target, note);
		assert.match(checkArchivedNotes(root).join("\n"), /必须且只能有一条 Archived/u);
		writeFileSync(target, `${archived}Archived: 2026-09-16\n`);
		assert.match(checkArchivedNotes(root).join("\n"), /必须且只能有一条 Archived/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("归档原文保留旧编号文件名与标题，不触发活动笔记规则", () => {
	const root = fixture();
	try {
		const archivedDir = join(root, ".agents/notes/archived/architecture");
		mkdirSync(archivedDir, { recursive: true });
		writeFileSync(
			join(archivedDir, "2026-09-01-adr-0005-old-boundary.md"),
			"# Agent Note: ADR-0005 旧边界\n\nStatus: implemented\n\n## 决策\n\n保留原文。\n\nArchived: 2026-09-16\n",
		);
		execFileSync("git", ["init", "-q"], { cwd: root });
		for (const script of [
			"check-notes-tree.ts",
			"check-notes-format.ts",
			"check-archived-agent-notes.ts",
		]) {
			const result = run(root, script);
			assert.equal(result.status, 0, result.stdout + result.stderr);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("归档保留历史章节与失效链接，模板不参与树和格式检查", () => {
	const root = fixture();
	try {
		const source = ".agents/notes/implemented/architecture/2026-09-16-old-boundary.md";
		writeFileSync(join(root, source), `${note}\n## 迁移计划\n\n[历史](./removed.md)\n`);
		const target = archiveNote(root, source);
		mkdirSync(join(root, ".agents/notes/templates"));
		writeFileSync(join(root, ".agents/notes/templates/archived.md"), "# 归档示例\n");
		execFileSync("git", ["init", "-q"], { cwd: root });
		for (const script of [
			"check-notes-tree.ts",
			"check-notes-format.ts",
			"check-archived-agent-notes.ts",
		]) {
			const result = run(root, script);
			assert.equal(result.status, 0, result.stdout + result.stderr);
		}
		assert.deepEqual(checkDocumentationLinks(root), []);
		mkdirSync(join(root, "docs"));
		writeFileSync(join(root, "docs/current.md"), `[历史归档](../${target})\n`);
		assert.deepEqual(checkDocumentationLinks(root), []);
		rmSync(join(root, target));
		assert.match(checkDocumentationLinks(root).join("\n"), /不存在/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("已提交归档的替代笔记后来退役，不要求改写历史链接", () => {
	const root = fixture();
	try {
		const source = ".agents/notes/implemented/architecture/2026-09-01-old-boundary.md";
		const replacement = ".agents/notes/implemented/architecture/2026-09-02-new-boundary.md";
		writeFileSync(join(root, source), note);
		writeFileSync(join(root, replacement), note);
		archiveNote(root, source, replacement);
		commit(root);
		rmSync(join(root, replacement));
		assert.deepEqual(checkArchivedNotes(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("引用报告包含 owner 文档和模块 README，按来源去重且不统计模板或代码示例", () => {
	const root = fixture();
	try {
		const notePath = ".agents/notes/implemented/architecture/2026-09-01-old-boundary.md";
		writeFileSync(join(root, notePath), note);
		execFileSync("git", ["init", "-q"], { cwd: root });
		mkdirSync(join(root, "docs"));
		mkdirSync(join(root, "packages/example"), { recursive: true });
		const link = `[决策](../${notePath})`;
		writeFileSync(join(root, "docs/README.md"), `${link}\n${link}\n`);
		let result = noteAnchorReport(root);
		assert.ok(result.some((line) => line.includes("无 owner") && line.includes("总入站 1")));
		mkdirSync(join(root, ".agents/notes/templates"));
		writeFileSync(
			join(root, ".agents/notes/templates/example.md"),
			"[示例](../implemented/architecture/2026-09-01-old-boundary.md)\n",
		);
		writeFileSync(join(root, "docs/current.md"), `${link}\n${link}\n`);
		writeFileSync(join(root, "packages/example/README.md"), `\`${notePath}\`\n`);
		writeFileSync(join(root, "docs/code-example.md"), `\`\`\`markdown\n${link}\n\`\`\`\n`);
		result = noteAnchorReport(root);
		assert.equal(
			result.filter((line) => line.includes("无 owner") && line.includes(notePath)).length,
			0,
		);
		assert.ok(result.some((line) => line.includes("3 个来源文件") && line.includes(notePath)));
		rmSync(join(root, "docs/current.md"));
		assert.equal(
			noteAnchorReport(root).filter((line) => line.includes("无 owner") && line.includes(notePath))
				.length,
			0,
		);
		const cli = run(root, "check-note-anchors.ts");
		assert.equal(cli.status, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("治理引入当天的新笔记也要求完整章节", () => {
	const root = fixture();
	try {
		writeFileSync(join(root, ".agents/notes/implemented/architecture/2026-09-16-example.md"), note);
		const result = run(root, "check-notes-format.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.stdout + result.stderr, /缺少 “## 背景”/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("提案需要备选、可观察的验收目标和风险，拒绝后保留提案与备选", () => {
	const root = fixture();
	try {
		const proposedDir = join(root, ".agents/notes/proposed/process");
		const rejectedDir = join(root, ".agents/notes/rejected/process");
		mkdirSync(proposedDir, { recursive: true });
		mkdirSync(rejectedDir, { recursive: true });
		const proposed = join(proposedDir, "2026-09-16-example.md");
		const base =
			"# Agent Note: 提案\n\nStatus: proposed\n\n## 背景\n\n重复维护。\n\n## 提案\n\n统一入口。\n";
		writeFileSync(proposed, base);
		let result = run(root, "check-notes-format.ts");
		assert.notEqual(result.status, 0);
		for (const section of ["未采用方案", "验收标准", "风险"]) {
			assert.ok(result.stderr.includes(`缺少 “## ${section}”`), result.stderr);
		}
		const complete = `${base}\n## 未采用方案\n\n保留双入口会继续漂移。\n\n## 验收标准\n\n两个消费者调用同一入口。\n\n## 风险\n\n须同步调整调用方。\n`;
		writeFileSync(proposed, complete);
		result = run(root, "check-notes-format.ts");
		assert.equal(result.status, 0, result.stdout + result.stderr);
		rmSync(proposed);
		const rejected = join(rejectedDir, "2026-09-16-example.md");
		const declined = complete.replace("Status: proposed", "Status: rejected — 消费者职责不同");
		writeFileSync(rejected, declined);
		result = run(root, "check-notes-format.ts");
		assert.equal(result.status, 0, result.stdout + result.stderr);
		writeFileSync(rejected, declined.replace("## 未采用方案\n\n保留双入口会继续漂移。\n", ""));
		result = run(root, "check-notes-format.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /缺少 “## 未采用方案”/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("落地时仅改状态不足以完成转换，必须改写提案章节", () => {
	const root = fixture();
	try {
		const file = join(root, ".agents/notes/implemented/process/2026-09-16-example.md");
		const implemented =
			"# Agent Note: 单入口\n\nStatus: implemented\n\n## 背景\n\n双入口漂移。\n\n## 决策\n\n共用入口。\n\n## 未采用方案\n\n独立实现会漂移。\n\n## 后果\n\n消费者共同维护入口。\n";
		writeFileSync(file, `${implemented}\n## 验收标准\n\n未来迁移消费者。\n`);
		let result = run(root, "check-notes-format.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /implemented 笔记禁止提案式标题/u);
		writeFileSync(file, implemented);
		result = run(root, "check-notes-format.ts");
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Markdownlint 跳过冻结归档，仍拒绝活动笔记的重复标题", () => {
	const root = fixture();
	try {
		writeFileSync(
			join(root, ".markdownlint-cli2.jsonc"),
			readFileSync(join(repositoryRoot, ".markdownlint-cli2.jsonc")),
		);
		const active = ".agents/notes/implemented/process/2026-09-16-example.md";
		const archived = ".agents/notes/archived/process/2026-09-16-example.md";
		mkdirSync(join(root, ".agents/notes/archived/process"), { recursive: true });
		const duplicate = "# 原始标题\n\n# 重复标题\n";
		writeFileSync(join(root, active), duplicate);
		writeFileSync(join(root, archived), duplicate);
		const lint = (files: string[]) =>
			spawnSync(
				resolve(repositoryRoot, "node_modules/.bin/markdownlint-cli2"),
				["--no-globs", "--", ...files],
				{
					cwd: root,
					encoding: "utf8",
				},
			);
		let result = lint([active, archived]);
		assert.notEqual(result.status, 0);
		assert.match(result.stdout + result.stderr, /MD025/u);
		result = lint([archived]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
