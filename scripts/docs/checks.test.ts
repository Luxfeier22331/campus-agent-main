import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const tsx = resolve(repositoryRoot, "node_modules/.bin/tsx");

function write(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

function run(root: string, script: string): { status: number | null; output: string } {
	const result = spawnSync(tsx, [resolve(repositoryRoot, script)], {
		cwd: root,
		encoding: "utf8",
	});
	return {
		status: result.status,
		output: `${result.stdout}${result.stderr}`,
	};
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "campus-agent-docs-check-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("普通文档只允许 active", () => {
	withFixture((root) => {
		write(
			root,
			"docs/product/proposal.md",
			"---\ndoc_type: product_requirement\nowner_boundary: docs/product\nstatus: proposed\n---\n# 提案\n",
		);
		const result = run(root, "scripts/docs/check-frontmatter.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /product_requirement 只允许 status: active/u);
	});
});

test("笔记树拒绝未知 lifecycle 与不规范文件名", () => {
	withFixture((root) => {
		write(root, ".agents/notes/README.md", "# 决策笔记\n");
		write(root, ".agents/notes/draft/note.md", "# Agent Note: 草稿\n\nStatus: implemented\n");
		write(
			root,
			".agents/notes/implemented/architecture/adr-0001-object-storage.md",
			"# Agent Note: 对象存储\n\nStatus: implemented\n",
		);
		const result = run(root, "scripts/docs/check-notes-tree.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /未知 lifecycle/u);
		assert.match(result.output, /文件名须为 yyyy-mm-dd-topic\.md/u);
	});
});

test("笔记格式校验 Status 与必备节", () => {
	withFixture((root) => {
		write(root, ".agents/notes/README.md", "# 决策笔记\n");
		write(
			root,
			".agents/notes/implemented/process/2026-10-01-new-gate.md",
			"# Agent Note: 新门禁\n\nStatus: proposed\n\n## 决策\n\n内容\n",
		);
		const result = run(root, "scripts/docs/check-notes-format.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /Status 与目录 implemented 不一致/u);
	});
});

test("新笔记必备节缺失即失败", () => {
	withFixture((root) => {
		write(root, ".agents/notes/README.md", "# 决策笔记\n");
		write(
			root,
			".agents/notes/implemented/process/2026-10-01-new-gate.md",
			"# Agent Note: 新门禁\n\nStatus: implemented\n\n## 决策\n\n内容\n",
		);
		const result = run(root, "scripts/docs/check-notes-format.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /缺少 “## 背景”/u);
		assert.match(result.output, /缺少 “## 未采用方案”/u);
		assert.match(result.output, /缺少 “## 后果”/u);
	});
});

test("迁移笔记与新笔记使用同一章节要求，无法恢复的权衡可以明确说明", () => {
	withFixture((root) => {
		const file = ".agents/notes/implemented/architecture/2026-07-16-object-storage.md";
		const incomplete =
			"# Agent Note: 对象存储\n\nStatus: implemented\n\n## 决策\n\n使用 S3 兼容接口。\n";
		write(root, file, incomplete);
		let result = run(root, "scripts/docs/check-notes-format.ts");
		assert.notEqual(result.status, 0);
		for (const section of ["背景", "未采用方案", "后果"]) {
			assert.ok(result.output.includes(`缺少 “## ${section}”`), result.output);
		}
		write(
			root,
			file,
			`${incomplete}\n## 背景\n\n采集产物需要稳定引用。\n\n## 未采用方案\n\n原记录未保存托管方式的比较，不补造成本结论。\n\n## 后果\n\n消费者不依赖主机路径。\n`,
		);
		result = run(root, "scripts/docs/check-notes-format.ts");
		assert.equal(result.status, 0, result.output);
	});
});

test("活动生命周期拒绝编号文件名", () => {
	withFixture((root) => {
		write(root, ".agents/notes/README.md", "# 决策笔记\n");
		for (const lifecycle of ["proposed", "implemented", "rejected"]) {
			write(
				root,
				`.agents/notes/${lifecycle}/architecture/2026-10-01-adr-0099-topic.md`,
				"# Agent Note: 话题\n\nStatus: implemented\n",
			);
		}
		const result = run(root, "scripts/docs/check-notes-tree.ts");
		assert.notEqual(result.status, 0);
		assert.equal((result.output.match(/不得包含 ADR 编号/gu) ?? []).length, 3);
	});
});

test("活动笔记拒绝编号标题", () => {
	withFixture((root) => {
		write(root, ".agents/notes/README.md", "# 决策笔记\n");
		const bodies: Record<string, string> = {
			proposed:
				"## 背景\n\nx\n\n## 提案\n\nx\n\n## 未采用方案\n\nx\n\n## 验收标准\n\nx\n\n## 风险\n\nx",
			implemented: "## 背景\n\nx\n\n## 决策\n\nx\n\n## 未采用方案\n\nx\n\n## 后果\n\nx",
			rejected: "## 背景\n\nx\n\n## 提案\n\nx\n\n## 未采用方案\n\nx",
		};
		for (const lifecycle of ["proposed", "implemented", "rejected"]) {
			write(
				root,
				`.agents/notes/${lifecycle}/process/2026-10-01-topic.md`,
				`# Agent Note: ADR-0099 话题\n\nStatus: ${lifecycle}${lifecycle === "rejected" ? " — 被新决策取代" : ""}\n\n${bodies[lifecycle]}\n`,
			);
		}
		const result = run(root, "scripts/docs/check-notes-format.ts");
		assert.notEqual(result.status, 0);
		assert.equal((result.output.match(/不得包含 ADR 编号/gu) ?? []).length, 3);
	});
});

test("正文历史编号与 ADR 话题标题通过检查", () => {
	withFixture((root) => {
		write(root, ".agents/notes/README.md", "# 决策笔记\n");
		write(
			root,
			".agents/notes/implemented/process/2026-10-01-adr-migration.md",
			"# Agent Note: ADR 编号迁移为话题命名\n\nStatus: implemented\n\n## 背景\n\n早期 ADR-0007 选择 hybrid retrieval。\n\n## 决策\n\n使用话题命名。\n\n## 未采用方案\n\n保留双轨命名。\n\n## 后果\n\n引用使用话题名。\n",
		);
		let result = run(root, "scripts/docs/check-notes-format.ts");
		assert.equal(result.status, 0, result.output);
		result = run(root, "scripts/docs/check-notes-tree.ts");
		assert.equal(result.status, 0, result.output);
	});
});

test("预算超限即失败", () => {
	withFixture((root) => {
		write(root, "scripts/docs/doc-budgets.json", JSON.stringify({ "docs/README.md": 2 }));
		write(root, "docs/README.md", "# 文档\n\n第 3 行\n");
		const result = run(root, "scripts/docs/check-budgets.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /超过预算 2/u);
	});
});
