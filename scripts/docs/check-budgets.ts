import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = resolve(process.cwd(), "scripts/docs/doc-budgets.json");
const budgets = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, number>;
const errors: string[] = [];

for (const [file, budget] of Object.entries(budgets)) {
	const path = resolve(process.cwd(), file);
	if (!existsSync(path)) {
		errors.push(`${file}: 预算目标不存在`);
		continue;
	}
	const lineCount = readFileSync(path, "utf8").split(/\r?\n/u).length;
	if (lineCount > budget) {
		errors.push(`${file}: ${lineCount} 行超过预算 ${budget}`);
	}
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(error);
	}
	process.exitCode = 1;
} else {
	console.log(`Doc budgets check passed for ${Object.keys(budgets).length} files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	void 0;
}
