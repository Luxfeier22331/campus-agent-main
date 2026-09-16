import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const notesDir = resolve(process.cwd(), ".agents/notes");
const requiredSectionsByLifecycle: Record<string, string[]> = {
	proposed: ["背景", "提案", "未采用方案", "验收标准", "风险"],
	implemented: ["背景", "决策", "未采用方案", "后果"],
	rejected: ["背景", "提案", "未采用方案"],
};
const proposalHeadings = /^##\s*(提案|验收标准|迁移计划|实施计划)\s*$/u;
const errors: string[] = [];

function noteFiles(lifecycle: string): string[] {
	const lifecycleDir = resolve(notesDir, lifecycle);
	if (!existsSync(lifecycleDir)) {
		return [];
	}
	return readdirSync(lifecycleDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) =>
			readdirSync(resolve(lifecycleDir, entry.name))
				.filter((file) => file.endsWith(".md"))
				.map((file) => `${lifecycle}/${entry.name}/${file}`),
		);
}

for (const lifecycle of ["proposed", "implemented", "rejected"]) {
	for (const relPath of noteFiles(lifecycle)) {
		const path = resolve(notesDir, relPath);
		const lines = readFileSync(path, "utf8").split(/\r?\n/u);
		const file = relative(process.cwd(), path);
		const [first = "", second = "", third = ""] = lines;
		if (!first.startsWith("# Agent Note: ") || first.trim().length <= "# Agent Note: ".length) {
			errors.push(`${file}: 第一行须为 “# Agent Note: <标题>”`);
			continue;
		}
		if (second !== "") {
			errors.push(`${file}: 标题后须为空行`);
			continue;
		}
		if (!third.startsWith("Status: ")) {
			errors.push(`${file}: 第三行须为 “Status: <lifecycle>”`);
			continue;
		}
		const status = third.slice("Status: ".length).trim();
		if (lifecycle === "rejected") {
			if (!/^rejected\s+—\s+\S/u.test(status)) {
				errors.push(`${file}: rejected 笔记须在状态行追加 “— 原因”`);
			}
		} else if (status !== lifecycle) {
			errors.push(`${file}: Status 与目录 ${lifecycle} 不一致`);
			continue;
		}
		const headings = new Set(
			lines.filter((line) => /^##\s/u.test(line)).map((line) => line.replace(/^##\s*|\s*$/gu, "")),
		);
		const required = requiredSectionsByLifecycle[lifecycle] ?? [];
		for (const section of required) {
			if (!headings.has(section)) {
				errors.push(`${file}: 缺少 “## ${section}”（活动笔记必备节）`);
			}
		}
		if (lifecycle === "implemented") {
			for (const line of lines) {
				if (proposalHeadings.test(line)) {
					errors.push(`${file}: implemented 笔记禁止提案式标题 “${line.trim()}”`);
				}
			}
		}
	}
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	const total = ["proposed", "implemented", "rejected"].reduce(
		(count, lifecycle) => count + noteFiles(lifecycle).length,
		0,
	);
	console.log(`Notes format check passed for ${total} notes.`);
}
