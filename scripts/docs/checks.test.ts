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

test("普通文档只允许 active，ADR 只允许 accepted", () => {
	withFixture((root) => {
		write(
			root,
			"docs/product/proposal.md",
			"---\ndoc_type: product_requirement\nowner_boundary: docs/product\nstatus: proposed\n---\n# 提案\n",
		);
		write(
			root,
			"docs/decisions/adr-0001-old.md",
			"---\ndoc_type: decision\nowner_boundary: docs/decisions\ndecision_id: ADR-0001\nstatus: superseded\n---\n# ADR-0001 旧决策\n",
		);
		const result = run(root, "scripts/docs/check-frontmatter.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /product_requirement 只允许 status: active/u);
		assert.match(result.output, /decision 只允许 status: accepted/u);
	});
});

test("accepted ADR 必须由 decisions 之外的当前文档引用", () => {
	withFixture((root) => {
		write(
			root,
			"docs/decisions/adr-0001-choice.md",
			"---\ndoc_type: decision\nowner_boundary: docs/decisions\ndecision_id: ADR-0001\nstatus: accepted\n---\n# ADR-0001 选择\n",
		);
		write(
			root,
			"docs/product/current.md",
			"---\ndoc_type: product_requirement\nowner_boundary: docs/product\nstatus: active\n---\n# 当前产品\n",
		);
		const result = run(root, "scripts/docs/check-adr-ids.ts");
		assert.notEqual(result.status, 0);
		assert.match(result.output, /accepted ADR 没有当前所有者文档引用/u);
	});
});

test("ADR ID 或路径引用均满足可达性，supersedes 可以指向已删除 ID", () => {
	withFixture((root) => {
		write(
			root,
			"docs/decisions/adr-0002-current.md",
			"---\ndoc_type: decision\nowner_boundary: docs/decisions\ndecision_id: ADR-0002\nstatus: accepted\nsupersedes: ADR-0001\n---\n# ADR-0002 当前决策\n",
		);
		write(
			root,
			"docs/decisions/adr-0003-path.md",
			"---\ndoc_type: decision\nowner_boundary: docs/decisions\ndecision_id: ADR-0003\nstatus: accepted\n---\n# ADR-0003 路径决策\n",
		);
		write(
			root,
			"docs/architecture/current.md",
			"---\ndoc_type: architecture\nowner_boundary: docs/architecture\nstatus: active\n---\n# 当前架构\n\n采用 ADR-0002，并参考 `adr-0003-path.md`。\n",
		);
		const result = run(root, "scripts/docs/check-adr-ids.ts");
		assert.equal(result.status, 0, result.output);
	});
});
